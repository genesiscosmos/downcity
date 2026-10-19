/**
 * 完成事件可靠性回归：写前日志故障、崩溃窗口、接收方移除、自动重试和关闭取消。
 * 使用真实 Agent/City 存储边界与可编程模型，只替换故障点和外部回调，不访问真实服务。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Agent, City, Workspace, MemoryStorageProvider, LocalStorageProvider } from "../../city/bin/index.js";
import { SessionCompletions } from "../bin/agent/SessionCompletions.js";
import { MockModelClient } from "./ModelClientMock.mjs";

/** 稳定注册名，不以函数名或数组位置识别回调。 */
function named_handler(handler_id, handler) {
  return Object.assign(handler, { handler_id });
}

/** 为外部回调建立可等待的受理点。 */
function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

/** 等待受理有明确上限，不通过轮询读取运行时状态。 */
async function within(promise, timeout_ms = 5000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Callback did not arrive")), timeout_ms);
    })]);
  } finally { clearTimeout(timer); }
}

/** 所有用例只运行内存模型，不产生额度消耗。 */
function create_model(on_call = () => {}) {
  return new MockModelClient({ id: "completion-model", generate: async (call) => {
    on_call(call);
    return { text: "Completed result" };
  } });
}

/** 构造带完成回调的 Agent。 */
function create_agent(handler, model = create_model()) {
  return new Agent({ id: "completion-agent", model, hooks: {
    pipeline: {}, guard: {}, effect: { "session.turn_committed": [handler] },
  } });
}

/** 单条完成日志的故障注入工具；只操作当前用例的内存私有存储。 */
async function force_due(files) {
  for (const entry of await files.read_directory("completions")) {
    if (!entry.name.endsWith(".json")) continue;
    const file_path = `completions/${entry.name}`;
    const record = JSON.parse((await files.read_file(file_path)).toString());
    for (const delivery of Object.values(record.deliveries)) delivery.retry_at = 0;
    await files.write_file_atomically(file_path, JSON.stringify(record));
  }
}

test("写前日志失败不得确认成功；恢复存储后原 request_id 可以继续", async () => {
  const received = deferred();
  const agent = create_agent(named_handler("result_outbox", async (event) => { received.resolve(event); }));
  const queue = agent.resolve_completions();
  const files = queue.options.files;
  const write = files.write_file_atomically.bind(files);
  try {
    files.write_file_atomically = async (file_path, ...args) => {
      if (file_path.startsWith("completions/")) throw new Error("Journal disk unavailable");
      return await write(file_path, ...args);
    };
    const session = await agent.session();
    const turn = await session.prompt({ query: "review", request_id: "stable-request" });
    await assert.rejects(turn.finished, /could not be persisted/);
    assert.equal((await session.messages()).items.filter((message) => message.role === "agent").at(-1).state, "streaming");
    files.write_file_atomically = write;
    const retried = await session.prompt({ query: "review", request_id: "stable-request" });
    assert.equal((await retried.finished).success, true);
    assert.equal((await within(received.promise)).turn_id, turn.id);
  } finally { files.write_file_atomically = write; await agent.dispose(); }
});

test("canonical 终态后的日志确认失败仍可补发，幂等输入不重跑模型", async () => {
  let model_calls = 0;
  const received = deferred();
  const agent = create_agent(named_handler("result_outbox", async (event) => { received.resolve(event); }), create_model(() => { model_calls++; }));
  const queue = agent.resolve_completions();
  const files = queue.options.files;
  const write = files.write_file_atomically.bind(files);
  let writes = 0;
  try {
    files.write_file_atomically = async (file_path, ...args) => {
      if (file_path.startsWith("completions/") && ++writes > 1) throw new Error("Acknowledgement disk unavailable");
      return await write(file_path, ...args);
    };
    const session = await agent.session();
    const result = await (await session.prompt({ query: "review", request_id: "stable-request" })).finished;
    assert.equal(result.success, true);
    const before_retry = model_calls;
    files.write_file_atomically = write;
    await agent.resume_work();
    const event = await within(received.promise);
    assert.equal(event.result.text, result.text);
    const replay = await (await session.prompt({ query: "review", request_id: "stable-request" })).finished;
    assert.equal(replay.turn_id, result.turn_id);
    assert.equal(model_calls, before_retry);
  } finally { files.write_file_atomically = write; await agent.dispose(); }
});

test("写前提交后 canonical 收口中断，重建 Agent 后复用结果且不误标执行失败", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "downcity-completion-wal-"));
  let model_calls = 0;
  const model = create_model(() => { model_calls++; });
  const first_city = new City({ storage: new LocalStorageProvider(root) });
  const first = first_city.agents.add(create_agent(named_handler("result_outbox", async () => {}), model));
  const first_queue = first.resolve_completions();
  const prepare = first_queue.prepare.bind(first_queue);
  first_queue.prepare = async (...args) => {
    await prepare(...args);
    throw new Error("Simulated interruption after write-ahead commit");
  };
  const original = await first.session();
  const initial = await original.prompt({ query: "review", request_id: "stable-request" });
  await assert.rejects(initial.finished, /could not be persisted/);
  await first_city.close();
  const before_recovery = model_calls;
  const received = deferred();
  const second_city = new City({ storage: new LocalStorageProvider(root) });
  const second = second_city.agents.add(create_agent(named_handler("result_outbox", async (event) => { received.resolve(event); }), model));
  try {
    await second_city.powers.settled();
    await second.resume_work();
    const event = await within(received.promise);
    assert.equal(event.turn_id, initial.id);
    assert.equal(event.result.success, true);
    assert.equal(event.messages.filter((message) => message.role === "agent").at(-1).state, "done");
    assert.ok(event.messages.every((message) => message.parts.every((part) => part.type !== "error" || part.code !== "runtime_interrupted")));
    const restored = await second.session();
    const result = await (await restored.prompt({ query: "review", request_id: "stable-request" })).finished;
    assert.equal(result.success, true);
    assert.equal(result.turn_id, initial.id);
    assert.equal(model_calls, before_recovery);
  } finally { await second_city.close(); }
});

test("处理器移除和重排不丢回调，已确认处理器不随其它失败而重放", async () => {
  const files = new MemoryStorageProvider().open_scope(["completion-test"]).files;
  const context = { agent_id: "a", agent_name: "a", agent_description: "", agent_instructions: [], session_id: "s", session_origin: { type: "channel" }, turn_id: "t", messages: [], workspace_env: {} };
  const event = { completion_id: "completion:s:t", session_id: "s", turn_id: "t", status: "completed", result: { text: "done", success: true }, messages: [] };
  let success_calls = 0;
  let failing_calls = 0;
  const success = named_handler("first", async () => { success_calls++; });
  const failure = named_handler("second", async () => { failing_calls++; throw new Error("Offline"); });
  let handlers = [success, failure];
  const queue = new SessionCompletions({ files, get_handlers: () => handlers, restore_context: async () => context, report_error: () => {} });
  try {
    await queue.commit(event, context);
    await queue.settle();
    handlers = [];
    await force_due(files);
    await queue.resume();
    await queue.settle();
    handlers = [named_handler("second", async () => { failing_calls++; }), success];
    await queue.resume();
    await queue.settle();
    assert.equal(success_calls, 1);
    assert.equal(failing_calls, 2);
    await queue.resume();
    await queue.settle();
    assert.equal(success_calls, 1);
    assert.equal(failing_calls, 2);
  } finally { queue.suspend(); await queue.settle(); }
});

test("关闭会取消 callback，即使业务忽略信号也不阻塞 City.close", async () => {
  const entered = deferred();
  const blocked = deferred();
  let signal;
  const city = new City();
  const agent = city.agents.add(create_agent(named_handler("blocking", async (_event, context) => {
    signal = context.abort_signal;
    entered.resolve();
    await blocked.promise;
  })));
  try {
    const session = await agent.session();
    await (await session.prompt({ query: "review" })).finished;
    await within(entered.promise);
    await within(city.close());
    assert.equal(signal.aborted, true);
  } finally { blocked.resolve(); await city.close(); }
});

test("callback 超时保留待投递状态且不会并发重入忽略取消的业务函数", async () => {
  const files = new MemoryStorageProvider().open_scope(["timeout-test"]).files;
  const blocked = deferred();
  let calls = 0;
  let signal;
  const context = { agent_id: "a", agent_name: "a", agent_description: "", agent_instructions: [], session_id: "s", session_origin: { type: "channel" }, turn_id: "t", messages: [], workspace_env: {} };
  const event = { completion_id: "completion:s:t", session_id: "s", turn_id: "t", status: "completed", result: { text: "done", success: true }, messages: [] };
  const queue = new SessionCompletions({ files, timeout_ms: 20, report_error: () => {}, restore_context: async () => context, get_handlers: () => [named_handler("blocked", async (_event, call_context) => {
    calls++; signal = call_context.abort_signal; await blocked.promise;
  })] });
  try {
    await queue.commit(event, context);
    await within(queue.settle());
    assert.equal(signal.aborted, true);
    await force_due(files);
    await queue.resume();
    await queue.settle();
    assert.equal(calls, 1);
  } finally { queue.suspend(); blocked.resolve(); await queue.settle(); }
});

test("原 Session 临时恢复失败后自动回传，已完成的子任务不重跑", async () => {
  let worker_calls = 0;
  const city = new City({ workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  const caller = city.agents.add(new Agent({ id: "caller", model: create_model() }));
  const worker = city.agents.add(new Agent({ id: "worker", model: create_model(() => { worker_calls++; }) }));
  const delivered = deferred();
  try {
    await city.powers.settled();
    const parent = await caller.session();
    const delegations = worker.resolve_delegations();
    const get_parent = delegations.options.get_parent_session;
    let attempts = 0;
    delegations.options.get_parent_session = async (...args) => {
      if (++attempts === 1) throw new Error("Parent temporarily unavailable");
      return await get_parent(...args);
    };
    parent.subscribe((mutation) => {
      if (mutation.variant === "turn" && mutation.type === "finish") delivered.resolve();
    });
    const receipt = await delegations.spawn({ workspace_id: "project", query: "review" }, { agent_id: caller.id, session_id: parent.id, origin: parent.origin, turn_id: "caller-turn", tool_call_id: "call" });
    await delegations.settle();
    const before_retry = worker_calls;
    await within(delivered.promise);
    assert.equal(attempts, 2);
    assert.equal(worker_calls, before_retry);
    assert.equal((await delegations.options.store.get(receipt.delegation_id)).delivery_state, "delivered");
  } finally { await city.close(); }
});
