/** 后台恢复的完成事实、分页定位与故障隔离回归；所有数据均为测试构造，不请求模型。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "../bin/index.js";
import { recover_background_sessions } from "../bin/agent/SessionBackgroundRecovery.js";

/** 可信后台输入的最小 canonical 事实。 */
function background_input(session_id, turn_id = "latest-turn", sequence = 1) {
  return { session_id, message_id: `input-${sequence}`, turn_id, sequence, role: "user", revision: 1,
    created_at: 1, updated_at: 1, parts: [{ part_id: "input-part", sequence: 1, type: "text", text: "received" }],
    meta: { from: { kind: "runtime", namespace: "session_background", object_id: "result" } } };
}

/** 用可注入失败的只读端口测试恢复算法，不依赖执行器内部状态。 */
function scan_store(ids, read_messages = async id => ({ items: [background_input(id)], has_more: false })) {
  return {
    list_sessions: async ({ category }) => ({ items: category === "work" ? ids.map(session_id => ({ session_id })) : [], has_more: false }),
    read_session: async session_id => ({ messages: input => read_messages(session_id, input) }),
  };
}

test("只有未完成的后台轮次装配 Session 并收口，完成投递状态不参与判断", async () => {
  const checked = []; const restored = []; const statuses = [];
  await recover_background_sessions(scan_store(["completed", "interrupted"]), {
    is_completed: async (id, turn_id) => { checked.push([id, turn_id]); return id === "completed"; },
    has_recoverable_messages: async () => false,
    restore: async id => { restored.push(id); return { status: async () => { statuses.push(id); } }; },
    report_error: error => { throw error; },
  });
  assert.deepEqual(checked, [["completed", "latest-turn"], ["interrupted", "latest-turn"]]);
  assert.deepEqual(restored, ["interrupted"]);
  assert.deepEqual(statuses, ["interrupted"]);
});

test("跨消息页查找最新 Turn 的可信输入，忽略其他轮次的后台身份", async () => {
  const calls = []; const restored = [];
  const store = scan_store(["paged"], async (id, input) => {
    calls.push(input.before_sequence);
    if (input.before_sequence === undefined) {
      const input = { ...background_input(id, "new-turn", 101), role: "agent", meta: undefined,
        parts: [{ type: "input", part_id: "input-part", input_id: "latest-input", sequence: 1 }] };
      return { items: [input], has_more: true, next_before_sequence: 101 };
    }
    return { items: [background_input(id, "old-turn", 1), background_input(id, "new-turn", 2)], has_more: false };
  });
  await recover_background_sessions(store, {
    is_completed: async (_id, turn_id) => { assert.equal(turn_id, "new-turn"); return false; },
    restore: async id => { restored.push(id); return { status: async () => {} }; }, report_error: error => { throw error; },
  });
  assert.deepEqual(calls, [undefined, 101]);
  assert.deepEqual(restored, ["paged"]);
});

for (const phase of ["read_session", "read_messages", "read_completion", "read_recoverable_messages", "restore_session", "restore_status"]) {
  test(`${phase} 失败带原始异常与精确记录身份，后续 Session 仍恢复`, async () => {
    const failure = new Error("injected failure"); const errors = []; const restored = [];
    const store = scan_store(["bad", "good"], async id => {
      if (id === "bad" && phase === "read_messages") throw failure;
      return { items: [background_input(id)], has_more: false };
    });
    const read = store.read_session;
    store.read_session = async id => { if (id === "bad" && phase === "read_session") throw failure; return await read(id); };
    await recover_background_sessions(store, {
      is_completed: async id => { if (id === "bad" && phase === "read_completion") throw failure; return phase === "read_recoverable_messages"; },
      has_recoverable_messages: async id => { if (id === "bad") throw failure; return true; },
      restore: async id => {
        if (id === "bad" && phase === "restore_session") throw failure;
        return { status: async () => { if (id === "bad" && phase === "restore_status") throw failure; restored.push(id); } };
      },
      report_error: (error, context) => errors.push({ error, context }),
    });
    assert.equal(errors.length, 1); assert.equal(errors[0].error, failure);
    assert.deepEqual(errors[0].context, { session_id: "bad", category: "work", phase,
      ...(["read_completion", "read_recoverable_messages", "restore_session", "restore_status"].includes(phase) ? { turn_id: "latest-turn" } : {}) });
    assert.deepEqual(restored, ["good"]);
  });
}

test("目录读取失败保留分类定位并继续向宿主抛出，不能报告恢复成功", async () => {
  const failure = new Error("directory unavailable"); const errors = [];
  await assert.rejects(recover_background_sessions({ list_sessions: async () => { throw failure; } }, {
    report_error: (error, context) => errors.push({ error, context }),
  }), error => error === failure);
  assert.deepEqual(errors, [{ error: failure, context: { category: "chat", phase: "list_sessions" } }]);
});

test("导入历史与真人输入不进入后台恢复，也不读取完成日志", async () => {
  const store = scan_store(["imported", "human"], async id => {
    const message = background_input(id);
    if (id === "imported") message.origin = { session_id: "source", message_id: "source" };
    else message.meta.from = { kind: "user", user_id: "local" };
    return { items: [message], has_more: false };
  });
  const forbidden = async () => { assert.fail("must not restore or inspect completion"); };
  await recover_background_sessions(store, { restore: forbidden, is_completed: forbidden, report_error: error => { throw error; } });
});

test("真实 Agent 重启扫描已完成后台轮次不再装配执行器", async () => {
  let preparations = 0;
  const agent = new Agent({ id: "completed-background", prepare_work_session: async () => { preparations++; } });
  try {
    const session = await agent.sessions.create({ type: "chat", kind: "conversation" });
    const storage = await agent.sessions.read_session_storage(session.id, "chat");
    const turn_id = "completed-background-turn";
    await storage.create_message(background_input(session.id, turn_id));
    const completions = agent.resolve_completions();
    await completions.prepare({ completion_id: `completion:${session.id}:${turn_id}`, agent_id: agent.id,
      session_id: session.id, turn_id, status: "completed", messages: [], result: { success: true, text: "done" } },
      { session_origin: session.origin }, false);
    assert.equal(agent.sessions.release(session.id, "chat"), true);
    await agent.resume_work();
    assert.equal(preparations, 0);
    assert.equal((await completions.read(session.id, turn_id)).status, "completed");
  } finally { await agent.dispose(); }
});

test("后台完成日志先落盘而 canonical Message 尚未关闭时仍恢复收口，保留原成功结果", async () => {
  let preparations = 0;
  const agent = new Agent({ id: "prepared-background", prepare_work_session: async () => { preparations++; } });
  try {
    const session = await agent.sessions.create({ type: "chat", kind: "conversation" });
    const storage = await agent.sessions.read_session_storage(session.id, "chat");
    const turn_id = "prepared-background-turn";
    await storage.create_message(background_input(session.id, turn_id));
    await storage.create_message({ session_id: session.id, message_id: "open-agent", turn_id, role: "agent", state: "streaming",
      revision: 1, stable_part_sequence: 0, created_at: 2, updated_at: 2,
      parts: [{ part_id: "open-text", sequence: 1, type: "text", state: "streaming", text: "saved answer" }] });
    const completions = agent.resolve_completions();
    await completions.prepare({ completion_id: `completion:${session.id}:${turn_id}`, agent_id: agent.id,
      session_id: session.id, turn_id, status: "completed", messages: [], result: { success: true, text: "saved answer" } },
      { session_origin: session.origin }, false);
    assert.equal(agent.sessions.release(session.id, "chat"), true);
    await agent.resume_work();
    assert.equal(preparations, 1);
    assert.deepEqual(await storage.list_recoverable_agent_messages(), []);
    assert.equal((await completions.read(session.id, turn_id)).result.success, true);
    assert.ok((await storage.list_messages()).every(message => message.parts.every(part => part.type !== "error")));
  } finally { await agent.dispose(); }
});
