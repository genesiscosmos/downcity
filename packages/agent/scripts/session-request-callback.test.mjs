/** 验证 Turn 对象占用与 callback：异对象拒绝、同对象追加、接管后的原 Turn 通知。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Agent, SessionBusyError, local_user_prompt_actor as user } from "../bin/index.js";
import { City, LocalStorageProvider } from "../../city/bin/index.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockModelClient } from "./ModelClientMock.mjs";

/** 测试只阻塞受控模型和回调，不访问外部服务。 */
function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

/** 限时等待，失败后清理定时器。 */
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out")), 5000); })]); }
  finally { clearTimeout(timer); }
}

test("两个同时提交的独立工作只有一个获得 Session；执行完成后自动释放", async () => {
  const gate = deferred();
  const model = new MockModelClient({ id: "lock-model", generate: async () => { await gate.promise; return { text: "done" }; } });
  const agent = new Agent({ id: "lock-agent", model });
  try {
    const session = await agent.session();
    const [first, second] = await Promise.allSettled([
      session.prompt({ actor: user, query: "first", request_id: "first" }),
      session.prompt({ actor: { kind: "runtime", namespace: "test", object_id: "other" }, query: "second", request_id: "second" }),
    ]);
    assert.equal(first.status, "fulfilled");
    assert.equal(second.status, "rejected");
    assert.ok(second.reason instanceof SessionBusyError);
    assert.equal(second.reason.code, "session_busy");
    gate.resolve();
    await first.value.finished;
    assert.equal((await (await session.prompt({ actor: user, query: "next" })).finished).success, true);
  } finally { gate.resolve(); await agent.dispose(); }
});

test("callback 名称和参数随请求保存，失败仅重试该请求的 callback", async () => {
  const received = deferred();
  let model_calls = 0;
  let callback_calls = 0;
  const agent = new Agent({ id: "callback-agent", model: new MockModelClient({ id: "m", generate: async () => {
    model_calls++; return { text: "review result" };
  } }), callbacks: { review_completed: async (input) => {
    if (++callback_calls === 1) throw new Error("temporary destination failure");
    received.resolve(input);
  } } });
  try {
    const session = await agent.session();
    const turn = await session.prompt({ actor: user, request_id: "review-123", query: "review", callback: { name: "review_completed", data: { review_id: "123" } } });
    await turn.finished;
    const before_retry = model_calls;
    const input = await within(received.promise);
    assert.equal(input.request_id, "review-123");
    assert.deepEqual(input.data, { review_id: "123" });
    assert.equal(input.result.text, "review result");
    assert.equal(input.result.turn_id, turn.id);
    assert.ok(input.delivery_id);
    assert.equal(model_calls, before_retry);
    const replay = await session.prompt({ actor: user, request_id: "review-123", query: "review", callback: { name: "review_completed", data: { review_id: "123" } } });
    await replay.finished;
    await agent.completions.settle();
    assert.equal(callback_calls, 2);
  } finally { await agent.dispose(); }
});

test("重建 City 后按保存的 callback 名称和参数恢复，不重跑任务", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "downcity-request-callback-"));
  let calls = 0;
  const model = new MockModelClient({ id: "m", generate: async () => { calls++; return { text: "saved result" }; } });
  const first_city = new City({ storage: new LocalStorageProvider(root) });
  const first = first_city.agents.add(new Agent({ id: "persistent", model, callbacks: { saved: async () => { throw new Error("Offline"); } } }));
  const session = await first.session();
  await (await session.prompt({ actor: user, request_id: "r", query: "work", callback: { name: "saved", data: { job_id: 7 } } })).finished;
  await first.completions.settle();
  await first_city.close();
  const before_recovery = calls;
  const received = deferred();
  const second_city = new City({ storage: new LocalStorageProvider(root) });
  const second = second_city.agents.add(new Agent({ id: "persistent", model, callbacks: { saved: async (input) => { received.resolve(input); } } }));
  try {
    await second_city.powers.settled();
    await second.resume_work();
    const input = await within(received.promise);
    assert.deepEqual(input.data, { job_id: 7 });
    assert.equal(input.request_id, "r");
    assert.equal(input.result.text, "saved result");
    assert.equal(calls, before_recovery);
  } finally { await second_city.close(); }
});

test("未知 callback 或缺少 request_id 在执行模型前拒绝", async () => {
  let calls = 0;
  const agent = new Agent({ id: "validation", model: new MockModelClient({ id: "m", generate: async () => { calls++; return { text: "done" }; } }) });
  try {
    const session = await agent.session();
    await assert.rejects(session.prompt({ actor: user, query: "review", callback: { name: "missing" } }), /requires request_id/);
    await assert.rejects(session.prompt({ actor: user, request_id: "r", query: "review", callback: { name: "missing" } }), /Unknown Session callback/);
    assert.equal(calls, 0);
  } finally { await agent.dispose(); }
});

test("同对象可补充占用中的工作，同名 callback 的两个请求独立确认", async () => {
  const gate = deferred();
  const entered = deferred();
  const accepted = deferred();
  const deliveries = [];
  const agent = new Agent({ id: "send-agent", model: new MockModelClient({ id: "m", generate: async () => {
    entered.resolve(); await gate.promise; return { text: "done" };
  } }), callbacks: { saved: async (input) => { deliveries.push(input); if (deliveries.length === 2) accepted.resolve(); } } });
  try {
    const session = await agent.session();
    const first = await session.prompt({ actor: user, request_id: "a", query: "first", callback: { name: "saved", data: "a" } });
    await entered.promise;
    const second_task = session.prompt({ actor: user, request_id: "b", query: "more", callback: { name: "saved", data: "b" } });
    gate.resolve();
    const second = await second_task;
    assert.equal(first.id, second.id);
    await Promise.all([first.finished, second.finished]);
    await within(accepted.promise);
    assert.deepEqual(deliveries.map((item) => item.request_id).sort(), ["a", "b"]);
    assert.notEqual(deliveries[0].delivery_id, deliveries[1].delivery_id);
  } finally { gate.resolve(); await agent.dispose(); }
});

test("停止旧对象后用户可接管，迟到 callback 仍绑定旧 Turn stopped", async () => {
  const model_gate = deferred();
  const callback_gate = deferred();
  const received = deferred();
  let calls = 0;
  const actor = { kind: "session", agent_id: "source", workspace_id: null, session_id: "A", category: "chat" };
  const agent = new Agent({ id: "takeover", model: new MockModelClient({ id: "m", generate: async () => {
    if (++calls === 1) await model_gate.promise;
    return { text: "result" };
  } }), callbacks: { saved: async (input) => { await callback_gate.promise; received.resolve(input); } } });
  try {
    const session = await agent.session();
    const old = await session.prompt({ actor, query: "work", request_id: "old", callback: { name: "saved" } });
    await assert.rejects(session.prompt({ actor: user, query: "take over" }), SessionBusyError);
    await assert.rejects(session.stop("different-turn"), /Turn changed/);
    const stopping = session.stop(old.id);
    model_gate.resolve();
    await stopping;
    const next = await session.prompt({ actor: user, query: "new work" });
    await next.finished;
    callback_gate.resolve();
    const input = await within(received.promise);
    assert.equal(input.result.turn_id, old.id);
    assert.equal(input.result.success, false);
    assert.equal(input.result.error, "Turn stopped");
    assert.notEqual(next.id, old.id);
  } finally { model_gate.resolve(); callback_gate.resolve(); await agent.dispose(); }
});
