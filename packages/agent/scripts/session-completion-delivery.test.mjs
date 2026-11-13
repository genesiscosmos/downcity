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
import { AskQuestionsTool } from "../bin/tools/ask/AskQuestionsTool.js";
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
    const turn = await session.prompt({ actor: { kind: "user", user_id: "local" }, query: "review", request_id: "stable-request" });
    await assert.rejects(turn.finished, /could not be persisted/);
    assert.equal((await session.messages()).items.filter((message) => message.role === "agent").at(-1).state, "streaming");
    files.write_file_atomically = write;
    const retried = await session.prompt({ actor: { kind: "user", user_id: "local" }, query: "review", request_id: "stable-request" });
    assert.equal((await retried.finished).success, true);
    assert.equal((await within(received.promise)).turn_id, turn.id);
    const next = await session.prompt({ actor: { kind: "runtime", namespace: "test", object_id: "next-owner" }, query: "new work" });
    await next.finished;
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
    const result = await (await session.prompt({ actor: { kind: "user", user_id: "local" }, query: "review", request_id: "stable-request" })).finished;
    assert.equal(result.success, true);
    const before_retry = model_calls;
    files.write_file_atomically = write;
    await agent.resume_work();
    const event = await within(received.promise);
    assert.equal(event.result.text, result.text);
    const replay = await (await session.prompt({ actor: { kind: "user", user_id: "local" }, query: "review", request_id: "stable-request" })).finished;
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
  const initial = await original.prompt({ actor: { kind: "user", user_id: "local" }, query: "review", request_id: "stable-request" });
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
    const result = await (await restored.prompt({ actor: { kind: "user", user_id: "local" }, query: "review", request_id: "stable-request" })).finished;
    assert.equal(result.success, true);
    assert.equal(result.turn_id, initial.id);
    assert.equal(model_calls, before_recovery);
  } finally { await second_city.close(); }
});

test("处理器移除和重排不丢回调，已确认处理器不随其它失败而重放", async () => {
  const files = new MemoryStorageProvider().open_scope(["completion-test"]).files;
  const context = { agent_id: "a", agent_name: "a", agent_description: "", agent_instructions: [], session_id: "s", session_origin: { category: "chat", type: "channel" }, turn_id: "t", messages: [], workspace_env: {} };
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
    await (await session.prompt({ actor: { kind: "user", user_id: "local" }, query: "review" })).finished;
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
  const context = { agent_id: "a", agent_name: "a", agent_description: "", agent_instructions: [], session_id: "s", session_origin: { category: "chat", type: "channel" }, turn_id: "t", messages: [], workspace_env: {} };
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

test("Chat Turn 已结束后结果继续交付，临时恢复失败不会重跑子任务", async () => {
  let worker_calls = 0;
  const city = new City({ workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  const caller = city.agents.add(new Agent({ id: "caller", model: create_model() }));
  const worker = city.agents.add(new Agent({ id: "worker", model: create_model(() => { worker_calls++; }) }));
  const delivered = deferred();
  try {
    await city.powers.settled();
    const parent = await caller.session();
    const caller_turn = await parent.prompt({ request_id: "original", query: "start independent work" });
    await caller_turn.finished;
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
    const receipt = await delegations.spawn({ workspace_id: "project", query: "review" }, { agent_id: caller.id, session_id: parent.id, origin: parent.origin, turn_id: caller_turn.id, tool_call_id: "call" });
    await delegations.settle();
    const before_retry = worker_calls;
    await within((async () => {
      while ((await delegations.options.store.get(receipt.delegation_id)).delivery_state === "pending") {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    })());
    assert.equal(attempts, 2);
    assert.equal(worker_calls, before_retry);
    assert.equal((await delegations.options.store.get(receipt.delegation_id)).delivery_state, "delivered");
    await within(delivered.promise);
  } finally { await city.close(); }
});

test("停止Chat只结束当前回复，已派Main继续并交付", async () => {
  const chat_entered = deferred();
  const release_chat = deferred();
  const work_entered = deferred();
  const release_work = deferred();
  const delivered = deferred();
  let chat_calls = 0;
  const city = new City({ workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  const caller = city.agents.add(new Agent({ id: "independent-caller", model: new MockModelClient({ id: "chat", generate: async () => {
    if (++chat_calls === 1) { chat_entered.resolve(); await release_chat.promise; }
    return { text: "Main result received" };
  } }) }));
  const worker = city.agents.add(new Agent({ id: "independent-worker", model: new MockModelClient({ id: "worker", generate: async () => {
    work_entered.resolve(); await release_work.promise; return { text: "Main completed" };
  } }) }));
  try {
    await city.powers.settled();
    const chat = await caller.session();
    chat.dispose_title_generation();
    chat.subscribe((mutation) => { if (mutation.variant === "turn" && mutation.type === "finish" && mutation.status === "completed") delivered.resolve(); });
    const turn = await chat.prompt({ query: "start work", request_id: "chat-work" });
    await within(chat_entered.promise);
    const delegation = worker.resolve_delegations();
    const receipt = await delegation.spawn({ workspace_id: "project", query: "independent main" }, { agent_id: caller.id, session_id: chat.id, origin: chat.origin, turn_id: turn.id, tool_call_id: "spawn-main" });
    await within(work_entered.promise);
    const stop = chat.stop();
    release_chat.resolve();
    await stop;
    assert.equal((await delegation.options.store.get(receipt.delegation_id)).execution_state, "running");
    release_work.resolve();
    await within(delivered.promise);
    await delegation.settle();
    assert.equal((await delegation.options.store.get(receipt.delegation_id)).delivery_state, "delivered");
  } finally { release_chat.resolve(); release_work.resolve(); await city.close(); }
});

test("Task Main 等待跨Agent Child，并在停止时收口Child", async () => {
  const main_entered = deferred();
  const release_main = deferred();
  const child_entered = deferred();
  const release_child = deferred();
  const main_returned = deferred();
  const city = new City({ workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  const owner = city.agents.add(new Agent({ id: "main-owner", model: new MockModelClient({ id: "main", generate: async () => {
    main_entered.resolve(); await release_main.promise; main_returned.resolve(); return { text: "await child" };
  } }) }));
  const executor = city.agents.add(new Agent({ id: "child-owner", model: new MockModelClient({ id: "child", generate: async () => {
    child_entered.resolve(); await release_child.promise; return { text: "child result" };
  } }) }));
  try {
    await city.powers.settled();
    const main = await owner.sessions.create({ origin: { category: "work", type: "task", delegation_depth: 1 } });
    main.dispose_title_generation();
    const turn = await main.prompt({ query: "task main", request_id: "main-turn" });
    await within(main_entered.promise);
    const delegations = executor.resolve_delegations();
    const receipt = await delegations.spawn({ workspace_id: "project", query: "child work" }, { agent_id: owner.id, session_id: main.id, origin: main.origin, turn_id: turn.id, tool_call_id: "child-start" });
    await within(child_entered.promise);
    release_main.resolve();
    await within(main_returned.promise);
    // 完成模型输出不等于Main可结束，必须等Child；用下一事件循环观察已触发的收尾。
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await main.status()).state, "running");
    const stopping = main.stop();
    release_child.resolve();
    await within(stopping);
    assert.equal((await turn.finished).success, false);
    const record = await delegations.options.store.get(receipt.delegation_id);
    assert.equal(record.execution_state, "stopped");
    assert.equal(record.delivery_state, "cancelled");
  } finally { release_main.resolve(); release_child.resolve(); await city.close(); }
});

test("Child问题留在原Session，用户回答后仅将执行结果回传Main", async () => {
  const main_entered = deferred();
  const release_main = deferred();
  const main_returned = deferred();
  const release_question = deferred();
  const question_seen = deferred();
  const city = new City({ workspaces: [new Workspace({ id: "project", path: process.cwd() })] });
  let main_calls = 0;
  let child_calls = 0;
  const owner = city.agents.add(new Agent({ id: "question-main", model: new MockModelClient({ id: "main", generate: async () => {
    if (++main_calls === 1) { main_entered.resolve(); await release_main.promise; main_returned.resolve(); }
    return { text: "main" };
  } }) }));
  const executor = city.agents.add(new Agent({ id: "question-child", tools: { ask_question: AskQuestionsTool }, model: new MockModelClient({ id: "child", generate: async (call) => {
    if (!call.tools?.length) return { text: "question child" };
    if (++child_calls === 1) {
      await release_question.promise;
      return { content: [{ type: "tool_call", tool_call_id: "ask", tool_name: "ask_question", input: { title: "Region", questions: [{ question: "Which region?", type: "single_select", options: [{ value: "cn", label: "China" }] }] } }] };
    }
    return { text: "child answered" };
  } }) }));
  try {
    await city.powers.settled();
    const main = await owner.sessions.create({ origin: { category: "work", type: "task" } });
    main.dispose_title_generation();
    const turn = await main.prompt({ query: "main", request_id: "main" });
    await within(main_entered.promise);
    const delegations = executor.resolve_delegations();
    const receipt = await delegations.spawn({ workspace_id: "project", query: "ask first" }, { agent_id: owner.id, session_id: main.id, origin: main.origin, turn_id: turn.id, tool_call_id: "spawn" });
    const child = await executor.sessions.get(receipt.session_id, "work");
    child.dispose_title_generation();
    child.subscribe((mutation) => {
      if (mutation.variant === "part" && mutation.type === "tool") {
        const question = mutation.part.interactions?.find((item) => item.request.type === "question");
        if (question) question_seen.resolve(question.request);
      }
    });
    release_question.resolve();
    const question = await within(question_seen.promise);
    release_main.resolve();
    await within(main_returned.promise);
    await delegations.resume();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await main.status()).state, "running");
    assert.equal(main_calls, 1);
    assert.equal((await child.interactions())[0].interaction_id, question.interaction_id);
    assert.deepEqual(await main.interactions(), []);
    const pending_messages = await main.messages({ limit: 100, include_internal: true });
    assert.equal(pending_messages.items.flatMap((message) => message.parts).filter((part) => part.type === "context" && part.tag === "delegation_interaction").length, 0);

    await child.respond({ interaction_id: question.interaction_id, response: { type: "question", outcome: "resolved", payload: { answers: [{ question_id: question.payload.questions[0].question_id, value: "cn" }] } } });
    assert.equal((await within(turn.finished)).success, true);
    assert.deepEqual(await child.interactions(), []);
    const messages = await main.messages({ limit: 100, include_internal: true });
    const contexts = messages.items.flatMap((message) => message.parts).filter((part) => part.type === "context");
    assert.equal(contexts.filter((part) => part.tag === "delegation_interaction").length, 0);
    const results = contexts.filter((part) => part.tag === "delegation_result");
    assert.equal(results.length, 1);
    assert.equal(JSON.parse(results[0].context).text, "child answered");
  } finally { release_main.resolve(); release_question.resolve(); await city.close(); }
});

test("已接收后台续轮重建后明确收口中断，保留结果并释放占用", async () => {
  let model_calls = 0;
  const agent = new Agent({ id: "background-recovery", model: create_model(() => { model_calls++; }) });
  try {
    const session = await agent.session();
    const storage = await agent.sessions.read_session_storage(session.id, "chat");
    const turn_id = "interrupted-background-turn";
    await storage.create_message({
      message_id: "received-background", session_id: session.id, turn_id,
      role: "user", revision: 1, visibility: "internal", created_at: 1, updated_at: 1,
      meta: { from: { kind: "runtime", namespace: "session_background", object_id: "received" } },
      parts: [{ part_id: "received-part", sequence: 1, type: "text", text: "already received Main result" }],
    });
    assert.equal(agent.sessions.release(session.id, "chat"), true);
    await agent.resume_work();
    const restored = await agent.sessions.get(session.id, "chat");
    const status = await restored.status();
    assert.equal(status.state, "idle");
    assert.equal(status.occupied_by, null);
    const result = await agent.resolve_completions().read(restored.id, turn_id);
    assert.equal(result.status, "failed");
    assert.match(result.result.error, /interrupted/);
    assert.equal(model_calls, 0);
    const history = await restored.messages({ include_internal: true });
    assert.ok(history.items.some((message) => message.message_id === "received-background"));
  } finally { await agent.dispose(); }
});

test("后台完成使用稳定身份接收，并发重投不重复执行模型", async () => {
  let calls = 0;
  const agent = new Agent({ id: "background-agent", model: create_model(() => { calls++; }) });
  try {
    const session = await agent.session();
    session.dispose_title_generation();
    const original = await session.prompt({ query: "start", request_id: "original" });
    await original.finished;
    const done = deferred();
    session.subscribe((mutation) => {
      if (mutation.variant === "turn" && mutation.type === "finish" && mutation.turn_id !== original.id) done.resolve();
    });
    const input = { turn_id: original.id, request_id: "shell-exit:stable", query: "background command completed", resume_after_turn: true };
    assert.deepEqual(await Promise.all([session.accept_background_result(input), session.accept_background_result(input)]), ["accepted", "accepted"]);
    await within(done.promise);
    assert.equal(await session.accept_background_result(input), "accepted");
    assert.equal(calls, 2);
  } finally { await agent.dispose(); }
});

test("停止后的Shell结果不唤醒，独立Main仍可向Chat交付", async () => {
  const entered = deferred();
  const blocked = deferred();
  let calls = 0;
  const agent = new Agent({ id: "stopped-background", model: new MockModelClient({ id: "stop-model", generate: async () => {
    if (++calls === 1) { entered.resolve(); await blocked.promise; }
    return { text: "result" };
  } }) });
  try {
    const session = await agent.session();
    session.dispose_title_generation();
    const original = await session.prompt({ query: "start", request_id: "original" });
    await within(entered.promise);
    const stopping = session.stop();
    blocked.resolve();
    await stopping;
    await original.finished;
    assert.equal(await session.accept_background_result({ turn_id: original.id, request_id: "shell-exit:stopped", query: "late shell", resume_after_turn: true }), "discarded");
    const done = deferred();
    session.subscribe((mutation) => { if (mutation.variant === "turn" && mutation.type === "finish" && mutation.turn_id !== original.id) done.resolve(); });
    assert.equal(await session.accept_background_result({ turn_id: original.id, request_id: "main-result:independent", query: "main completed", resume_after_turn: true, allow_stopped_turn: true }), "accepted");
    await within(done.promise);
    assert.equal(calls, 2);
  } finally { blocked.resolve(); await agent.dispose(); }
});
