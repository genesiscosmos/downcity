/** 验证 Power Part 的数据库升级、角色约束、重放及模型摘要边界。 */
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SESSION_STORAGE_SCHEMA_SQL } from "../bin/session/storage/SessionStorageSchema.js";
import { migrate_session_storage } from "../bin/session/storage/SessionStorageMigration.js";
import { create_session_agent_content_part } from "../bin/session/messages/SessionAgentContent.js";
import { extract_session_message_text } from "../bin/session/messages/SessionMessageText.js";
import { session_messages_to_model_messages } from "../bin/model/messages/SessionModelMessages.js";
import { StepInput } from "../bin/session/input/StepInput.js";
import { project_published_tool_input } from "../bin/model/messages/SessionPowerProjection.js";

/** 代表性的业务内容，不依赖具体 Renderer。 */
const content = { type: "power", power_id: "presentation", schema_version: 1, data: { private_spec: "not model text" }, fallback_text: "调整参数查看结果" };

test("v3 原子升级保留消息身份并允许 Agent Power Part，User 仍受约束", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(SESSION_STORAGE_SCHEMA_SQL.replaceAll("'power', ", ""));
    database.exec(`
      PRAGMA user_version = 3;
      INSERT INTO messages(message_id, sequence, role, state, visibility, created_at, updated_at)
      VALUES ('user-1', 1, 'user', NULL, 'visible', 1, 1), ('agent-1', 2, 'agent', 'done', 'visible', 2, 2);
      INSERT INTO message_parts VALUES ('text-1', 'user-1', 1, NULL, 'text', '{"text":"原消息"}', 1, 1);
    `);
    migrate_session_storage(database, 3);
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 4);
    assert.equal(database.prepare("SELECT content FROM message_parts WHERE part_id = 'text-1'").get().content, '{"text":"原消息"}');
    const insert = database.prepare("INSERT INTO message_parts VALUES (?, ?, 1, NULL, 'power', ?, 2, 2)");
    insert.run("power-1", "agent-1", JSON.stringify(content));
    assert.throws(() => insert.run("power-2", "user-1", JSON.stringify(content)), /incompatible/);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name LIKE 'message_parts_%_index'").get().count, 3);
  } finally { database.close(); }
});

test("Power 内容补齐 canonical 身份并只使用回退文字投影", () => {
  const part = create_session_agent_content_part(content, "power-1", 1);
  assert.equal(part.part_id, "power-1");
  assert.equal(part.sequence, 1);
  assert.equal(extract_session_message_text({ role: "agent", parts: [part] }), content.fallback_text);
  assert.throws(() => create_session_agent_content_part({ ...content, schema_version: 0 }, "bad", 1), /schema_version/);
  assert.throws(() => create_session_agent_content_part({ ...content, data: { x: Infinity } }, "bad", 1), /JSON/);
});

test("来源绑定的 Spec 调用在模型历史中投影为摘要，原始 canonical 参数保持完整", async () => {
  const part = create_session_agent_content_part(content, "power-1", 2, "call-1");
  const tool = { type: "tool", part_id: "tool-1", sequence: 1, tool_name: "presentation", tool_call_id: "call-1", state: "completed", input: { action: "show", args: { content: "large-private-spec", fallback_text: content.fallback_text } }, output: { success: true } };
  const message = { role: "agent", parts: [tool, part] };
  const projected = await session_messages_to_model_messages([message]);
  assert.equal(JSON.stringify(projected).includes("large-private-spec"), false);
  assert.equal(JSON.stringify(projected).includes(content.fallback_text), true);
  const projected_call = projected.flatMap((message) => message.content).find((item) => item.type === "tool_call");
  assert.equal(projected_call.input.action, "show");
  assert.equal(projected_call.input.args.fallback_text, content.fallback_text);
  assert.match(projected_call.input.args.content, /Published UI description omitted/);
  assert.equal(tool.input.args.content, "large-private-spec");
  assert.equal(part.source_tool_call_id, "call-1");
});

test("未发布调用原样保留，描述压缩不丢失 action 与其他参数", () => {
  const input = { action: "show", args: { content: "original", fallback_text: "摘要", title: "保留" }, request_id: "request-1" };
  assert.strictEqual(project_published_tool_input(input, undefined), input);
  const projected = project_published_tool_input(input, "已发布摘要");
  assert.equal(projected.action, "show");
  assert.equal(projected.request_id, "request-1");
  assert.equal(projected.args.title, "保留");
  assert.equal(projected.args.fallback_text, "摘要");
  assert.match(projected.args.content, /已发布摘要/);
  assert.equal(input.args.content, "original");
  const unknown = { action: "other", args: { rows: [1, 2] } };
  assert.strictEqual(project_published_tool_input(unknown, "摘要"), unknown);
});

test("Action 返回前即发布内容，检查点只合并已经发布的 Parts", async () => {
  const events = [];
  let batch;
  const canonical = create_session_agent_content_part(content, "power-1", 1, "call-1");
  const turn = {
    lifecycle: { abort_signal: new AbortController().signal },
    output: {
      assistant: {
        prepare_tool_input: async () => events.push("prepare"),
        append_result_parts: async (parts, source) => {
          assert.equal(source, "call-1");
          assert.equal(parts[0], content);
          events.push("publish");
          return [canonical];
        },
      },
      enqueue_assistant_parts: (parts, publication) => { events.push("merge-record"); batch = { parts, ...publication }; },
    },
  };
  const tools = StepInput.prototype.bind_turn_context_to_tools.call({ create_tool_call_context: () => ({}) }, {
    presentation: { execute: async () => ({ output: { success: true }, messages: [{ role: "agent", parts: [content] }] }) },
  }, turn);
  const result = await tools.presentation.execute({}, { tool_call_id: "call-1" });
  assert.deepEqual(events, ["prepare", "publish", "merge-record"]);
  assert.deepEqual(result, { success: true });
  assert.deepEqual(batch.published_parts, [canonical]);
});
