/** 验证 compact 前原文分页与 SDK/Session Power 归档，包括忙碌拒绝和旧句柄封闭。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Agent, City, Workspace } from "../../city/bin/index.js";
import { MockModelClient } from "./ModelClientMock.mjs";
import { create_work_origin } from "../bin/agent/SessionWorkPolicy.js";

/** 真实 Session 存储和集合，模型使用固定结果，不消耗外部额度。 */
async function fixture(generate = async () => ({ text: "result" })) {
  const model = new MockModelClient({ id: "history-model", generate });
  const workspace = new Workspace({ id: "project", path: process.cwd() });
  const city = new City({ workspaces: [workspace] });
  const agent = city.agents.add(new Agent({ id: "owner", model }));
  const main = await agent.session();
  const tool = city.power_tools.session;
  assert.ok(tool, "City registers Session Power");
  const context = { agent_id: agent.id, agent_name: agent.name, agent_description: "", agent_instructions: [], session_id: main.id, session_origin: main.origin, turn_id: "caller-turn", tool_call_id: "call" };
  const create_work = async () => await agent.sessions.create({ workspace, origin: create_work_origin({
    agent_id: agent.id, session_id: main.id, origin: main.origin,
    turn_id: context.turn_id, tool_call_id: context.tool_call_id,
  }) });
  return { city, agent, workspace, main, tool, context, create_work };
}

test("messages 分页读取 compact 前原文，归档后列表保留历史而旧句柄不再执行", async () => {
  const f = await fixture();
  try {
    const work = await f.create_work();
    for (let index = 0; index < 4; index++) {
      await (await work.prompt({ actor: { kind: "user", user_id: "local" }, query: `original-${index}:` + "原始历史内容。".repeat(2200) })).finished;
    }
    const original = await work.messages({ limit: 100 });
    assert.equal(await work.compact(), true);
    const entries = [];
    let before_sequence;
    let pages = 0;
    while (true) {
      const page = (await f.tool.execute({ action: "messages", args: { session_id: work.id, session_category: "work", limit: 3, ...(before_sequence ? { before_sequence } : {}) } }, f.context)).output.data;
      assert.equal(page.source, "canonical_history");
      assert.equal(page.trust_level, "reference");
      entries.push(...page.items);
      pages++;
      if (!page.has_more) break;
      before_sequence = page.next_before_sequence;
      assert.ok(before_sequence);
      assert.ok(pages < 20);
    }
    assert.ok(pages > 1);
    assert.equal(new Set(entries.map((message) => message.message_id)).size, entries.length);
    for (const message of original.items) {
      const found = entries.find((entry) => entry.message_id === message.message_id);
      assert.ok(found);
      assert.deepEqual(found.parts, message.parts);
    }
    const archived = (await f.tool.execute({ action: "archive", args: { session_id: work.id } }, f.context)).output.data;
    assert.equal(archived.status, "archived");
    assert.ok(!(await f.agent.sessions.list()).items.some((item) => item.session_id === work.id));
    assert.ok((await f.agent.sessions.archived()).items.some((item) => item.session_id === work.id));
    await assert.rejects(work.prompt({ actor: { kind: "user", user_id: "local" }, query: "cannot restart" }), /archived/);
  } finally { await f.city.close(); }
});

test("运行和占用中的工作不能归档，结束后 SDK session.archive 可用", async () => {
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const f = await fixture(async () => { entered(); await gate; return { text: "done" }; });
  try {
    const work = await f.create_work();
    const turn = await work.prompt({ actor: { kind: "user", user_id: "local" }, query: "work" });
    await started;
    await assert.rejects(work.archive(), /executing|queued/);
    const busy = await f.tool.execute({ action: "archive", args: { session_id: work.id } }, f.context);
    assert.equal(busy.output.success, false);
    assert.match(busy.output.error, /session_subtree_busy|executing|queued/);
    release();
    await turn.finished;
    // finished 与队列消费者释放处于相邻 microtask，等待本轮事件循环收口。
    await new Promise((resolve) => setImmediate(resolve));
    await work.archive();
    await assert.rejects(work.prompt({ actor: { kind: "user", user_id: "local" }, query: "must reject" }), /archived/);
    const self = await f.tool.execute({ action: "archive", args: { session_id: f.main.id } }, f.context);
    assert.equal(self.output.success, false);
    assert.match(self.output.error, /session_target_forbidden/);
  } finally { release(); await f.city.close(); }
});

test("归档期间拒绝并发 prompt，归档失败恢复原句柄", async () => {
  const f = await fixture();
  try {
    const work = await f.create_work();
    work.begin_archive();
    await assert.rejects(work.prompt({ actor: { kind: "user", user_id: "local" }, query: "race" }), /archiving/);
    work.finish_archive(false);
    assert.equal((await (await work.prompt({ actor: { kind: "user", user_id: "local" }, query: "retry" })).finished).success, true);
  } finally { await f.city.close(); }
});
