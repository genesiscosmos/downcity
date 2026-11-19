/** 用独立数据根验证完成确认、委派执行边界、重复运行与原始字节回滚。 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const command = fileURLToPath(new URL("./migrate-session-journals.mjs", import.meta.url));

/** 只构造迁移查询所需的会话、父工具调用和私有日志。 */
function fixture(context, child_started = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-journals-test-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "data");
  const batch = path.join(directory, "batch");
  const agent_path = path.join(root, "agents", "agent");
  for (const name of ["completions", "delegations"]) fs.mkdirSync(path.join(agent_path, name), { recursive: true });
  const db = new DatabaseSync(path.join(agent_path, "sessions.db"));
  try {
    db.exec(`CREATE TABLE sessions (session_key INTEGER, session_id TEXT, type TEXT, descriptor TEXT);
      CREATE TABLE messages (session_key INTEGER, message_id TEXT, turn_id TEXT);
      CREATE TABLE message_parts (session_key INTEGER, message_id TEXT, type TEXT, content TEXT);
      INSERT INTO sessions VALUES (1,'parent','chat','{"type":"chat","kind":"main"}'),
        (2,'child','work','{"type":"work","kind":"work"}');
      INSERT INTO messages VALUES (1,'message','turn');
      INSERT INTO message_parts VALUES (1,'message','tool','{"tool_call_id":"call"}');`);
    if (child_started) db.exec("INSERT INTO messages VALUES (2,'started','child-turn')");
  } finally { db.close(); }

  const event = { session_id: "parent", turn_id: "turn", completion_id: "completion:parent:turn", status: "failed",
    result: { text: "original" }, messages: [{ role: "agent", parts: [
      { type: "inbox", inbox_id: "input", meta: { from: { kind: "session", category: "work" } } },
      { type: "power", data: { type: "inbox", inbox_id: "business" } },
    ] }] };
  const deliveries = { callback: { delivered: false, retry_at: 2, attempt_count: 1 } };
  const completion = { origin: { type: "agent" }, event, current: { ...event, result: { text: "retry" } }, state: "prepared", deliveries };
  const delegation = { delegation_id: "a".repeat(64), work_session_id: "child", execution_state: "pending", delivery_state: "pending",
    caller: { agent_id: "agent", session_id: "parent", turn_id: "turn", tool_call_id: "call", origin: { type: "agent", category: "chat" } },
    query: "保留原指令" };
  const completion_path = path.join(agent_path, "completions", `${createHash("sha256").update(event.completion_id).digest("hex")}.json`);
  const delegation_path = path.join(agent_path, "delegations", `${delegation.delegation_id}.json`);
  for (const [file_path, value] of [[completion_path, completion], [delegation_path, delegation]]) {
    fs.writeFileSync(file_path, `${JSON.stringify(value, null, 2)}\n`);
  }
  return { root, batch, completion_path, delegation_path, deliveries };
}

/** 所有阶段都走用户使用的命令入口；读取状态而非匹配日志文本。 */
function invoke(input, mode) {
  const args = [command, `--${mode}`, "--root", input.root];
  if (mode !== "preflight") args.push("--batch", input.batch);
  if (["apply", "restore"].includes(mode)) args.push("--writers-stopped");
  const run = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (run.error) throw run.error;
  return { code: run.status, report: JSON.parse(run.status === 0 ? run.stdout : run.stderr) };
}

test("保留完成快照和重试状态，只关闭可证实尚未执行的旧委派", context => {
  const input = fixture(context);
  const files = [input.completion_path, input.delegation_path];
  const before = files.map(file_path => fs.readFileSync(file_path));
  assert.equal(invoke(input, "preflight").report.delegations.stopped, 1);
  assert(!fs.existsSync(input.batch));
  assert.equal(invoke(input, "apply").report.status, "ready");
  assert.equal(invoke(input, "verify").report.status, "ready");

  const after = files.map(file_path => fs.readFileSync(file_path));
  const [completion, delegation] = after.map(content => JSON.parse(content));
  assert.deepEqual(completion.descriptor, { type: "chat", kind: "main" });
  assert.deepEqual(completion.deliveries, input.deliveries);
  assert.equal(completion.state, "prepared");
  assert.deepEqual([completion.event.result.text, completion.current.result.text], ["original", "retry"]);
  assert.deepEqual(completion.current.messages[0].parts, [
    { type: "input", input_id: "input", meta: { from: { kind: "session", type: "work" } } },
    { type: "view", data: { type: "inbox", inbox_id: "business" } },
  ]);
  assert.equal(delegation.query, "保留原指令");
  assert.deepEqual([delegation.execution_state, delegation.delivery_state], ["stopped", "cancelled"]);
  assert.equal(delegation.caller.execution_id, `legacy-delegation:${delegation.delegation_id}`);
  assert.equal(invoke(input, "preflight").report.completions.converted, 0);
  fs.appendFileSync(input.delegation_path, "\n");
  assert.equal(invoke(input, "restore").report.reason, "journal_live_changed_or_business_write");
  fs.writeFileSync(input.delegation_path, after[1]);
  assert.equal(invoke(input, "restore").report.status, "restored");
  assert.deepEqual(files.map(file_path => fs.readFileSync(file_path)), before);
});

test("缺少执行身份但子会话已有消息时阻止转换", context => {
  const input = fixture(context, true);
  assert.equal(invoke(input, "preflight").report.reason, "unbound_delegation_requires_review");
  assert.equal(invoke(input, "apply").report.reason, "unbound_delegation_requires_review");
  assert(!fs.existsSync(input.batch));
});
