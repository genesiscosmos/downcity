/**
 * @file 验证 canonical SessionMessage 的 SQLite 写入、交互、恢复与上下文策略。
 *
 * 测试只使用 Downcity Model Protocol 与 canonical SessionMessage，不经过 UI Message
 * 或 Executor Record 投影。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalFileSystem } from "@downcity/city";
import { SessionInteractions } from "../../agent/bin/session/control/SessionInteractions.js";
import { SessionShellApprovalAdapter } from "../../agent/bin/session/execution/tools/SessionShellApprovalAdapter.js";
import {
  normalize_session_user_parts,
  SessionMessages,
} from "../../agent/bin/session/SessionMessages.js";
import { session_messages_to_model_messages } from "../../agent/bin/executor/messages/SessionModelMessages.js";
import { SqliteSessionStorage } from "../../agent/bin/session/storage/SqliteSessionStorage.js";
import { AdaptivePartContextPolicy } from "../../agent/bin/session/composer/policies/AdaptivePartContextPolicy.js";
import { MockModelClient } from "../../agent/scripts/ModelClientMock.mjs";

/** 可让下一次 Assistant 草稿更新失败的测试 Store。 */
class FailingAssistantMessageStore extends SqliteSessionStorage {
  next_assistant_error = null;
  update_count = 0;

  fail_next_assistant_write(message) {
    this.next_assistant_error = new Error(message);
  }

  async update_message(...input) {
    this.update_count += 1;
    const error = this.next_assistant_error;
    if (error) {
      this.next_assistant_error = null;
      throw error;
    }
    return await super.update_message(...input);
  }
}

/** 创建隔离的 canonical SessionMessages 测试环境。 */
async function create_recorder(
  session_id = "session-messages-test",
  create_store = (options) => new SqliteSessionStorage(options),
) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-messages-"));
  const database_path = path.join(root_path, "session.db");
  const files = new LocalFileSystem(root_path);
  const events = [];
  const store = create_store({
    files,
    session_id,
    agent_id: "test-agent",
    origin: { type: "chat" },
    database_path,
    database_location: { type: "file" },
    attachments: {},
  });
  const recorder = new SessionMessages({
    session_id,
    store,
    attachment_store: store.attachments,
    publish: (mutation) => events.push(mutation),
  });
  await recorder.initialize();
  return {
    recorder,
    store,
    events,
    files,
    root_path,
    database_path,
  };
}

/** 写入一个完整的标准模型文本事件序列。 */
async function write_text(writer, content_id, text) {
  await writer.apply_model_event({ type: "text_start", content_id });
  await writer.apply_model_event({ type: "text_delta", content_id, delta: text });
  await writer.apply_model_event({ type: "text_finish", content_id });
}

/** 写入一个完整的标准模型工具调用事件序列。 */
async function write_tool_call(writer, input) {
  await writer.apply_model_event({
    type: "tool_call_start",
    content_id: input.content_id,
    tool_call_id: input.tool_call_id,
    tool_name: input.tool_name,
  });
  if (input.input_delta) {
    await writer.apply_model_event({
      type: "tool_call_delta",
      content_id: input.content_id,
      input_delta: input.input_delta,
    });
  }
  await writer.apply_model_event({
    type: "tool_call_finish",
    content_id: input.content_id,
    input: input.tool_input,
  });
}

/** 创建一条测试 User Message。 */
function create_user_message(session_id, sequence) {
  return {
    message_id: `user-${String(sequence)}`,
    session_id,
    turn_id: `turn-${String(sequence)}`,
    sequence,
    revision: 1,
    visibility: "visible",
    created_at: sequence,
    updated_at: sequence,
    role: "user",
    parts: [{
      part_id: `text-${String(sequence)}`,
      sequence: 1,
      type: "text",
      text: `message ${String(sequence)}`,
    }],
  };
}


test("User Context Part 保持 canonical 结构并安全映射到模型文本", async () => {
  const parts = normalize_session_user_parts([{
    type: "context",
    tag: "quoted_message",
    context: "A < B & C > D",
  }]);
  assert.deepEqual(parts, [{
    part_id: "user-context:1",
    sequence: 1,
    type: "context",
    tag: "quoted_message",
    context: "A < B & C > D",
  }]);

  const model_messages = await session_messages_to_model_messages([{
      message_id: "user-context-message",
      session_id: "user-context-session",
      turn_id: "user-context-turn",
      sequence: 1,
      revision: 1,
      visibility: "visible",
      created_at: 1,
      updated_at: 1,
      role: "user",
      parts,
    }]);
  assert.deepEqual(model_messages, [{
    role: "user",
    content: [{
      type: "text",
      text: "<quoted_message>A &lt; B &amp; C &gt; D</quoted_message>",
    }],
  }]);
  assert.throws(
    () => normalize_session_user_parts([{
      type: "context",
      tag: "quoted message",
      context: "invalid tag",
    }]),
    /Session context tag must start with a lowercase letter/,
  );
});

test("User data Part 明确只持久化，不进入模型输入", async () => {
  const model_messages = await session_messages_to_model_messages([{
    message_id: "user-data-message",
    session_id: "user-data-session",
    turn_id: "user-data-turn",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    role: "user",
    parts: [{
      part_id: "user-data:1",
      sequence: 1,
      type: "data",
      data_type: "data-view-state",
      data: { selected: true },
    }],
  }]);
  assert.deepEqual(model_messages, []);
});

test("文本中的 chat file markup 不再隐式生成模型附件", async () => {
  const model_messages = await session_messages_to_model_messages([{
    message_id: "user-markup-message",
    session_id: "user-markup-session",
    turn_id: "user-markup-turn",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    role: "user",
    parts: [{
      part_id: "user-text:1",
      sequence: 1,
      type: "text",
      text: '<file path="image.png" type="photo" />',
    }],
  }], process.cwd());
  assert.deepEqual(model_messages, [{
    role: "user",
    content: [{ type: "text", text: '<file path="image.png" type="photo" />' }],
  }]);
});

test("模型增量只更新内存投影，Step 完成后才写入 SQLite", async () => {
  const {
    recorder,
    events,
    store,
  } = await create_recorder();
  await recorder.append_user_message({
    turn_id: "turn-1",
    parts: [{ part_id: "user-text-1", sequence: 1, type: "text", text: "你好" }],
  });
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  await writer.apply_model_event({ type: "text_start", content_id: "text-1" });
  await writer.apply_model_event({ type: "text_delta", content_id: "text-1", delta: "你" });
  await writer.apply_model_event({ type: "text_delta", content_id: "text-1", delta: "好" });
  const active_during_stream = await store.list_messages();
  const draft = active_during_stream.at(-1);
  assert.deepEqual(active_during_stream.map((message) => message.role), ["user", "agent"]);
  assert.deepEqual(draft.parts, []);
  assert.equal(recorder.get_message(writer.message_id).parts[0].text, "你好");

  await writer.apply_model_event({ type: "text_finish", content_id: "text-1" });
  await writer.finish_step([{
    part_id: "text-1",
    sequence: 1,
    type: "text",
    text: "你好",
    state: "done",
  }]);
  const committed_step = await store.read_message(writer.message_id);
  assert.equal(committed_step.parts[0].text, "你好");
  assert.equal(committed_step.state, "streaming");
  await writer.complete();

  const active = await store.list_messages();
  assert.deepEqual(active.map((message) => message.role), ["user", "agent"]);
  assert.equal(active[1].parts[0].text, "你好");
  assert.equal(active[1].parts[0].state, "done");
  assert.equal(events.some((event) => event.variant === "delta"), true);
});

test("同一 Part 的高频 delta 在 Step 完成前不会写入 SQLite", async () => {
  const { recorder, store } = await create_recorder(
    "delta-batch-test",
    (options) => new FailingAssistantMessageStore(options),
  );
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  await writer.apply_model_event({ type: "text_start", content_id: "text-1" });
  const count_after_start = store.update_count;
  await writer.apply_model_event({ type: "text_delta", content_id: "text-1", delta: "a" });
  await writer.apply_model_event({ type: "text_delta", content_id: "text-1", delta: "b" });
  await writer.apply_model_event({ type: "text_delta", content_id: "text-1", delta: "c" });
  assert.equal(store.update_count, count_after_start);
  assert.deepEqual((await store.read_message(writer.message_id)).parts, []);
  await writer.apply_model_event({ type: "text_finish", content_id: "text-1" });
  await writer.finish_step([{
    part_id: "text-1",
    sequence: 1,
    type: "text",
    text: "abc",
    state: "done",
  }]);
  assert.equal(store.update_count, count_after_start + 1);
  assert.equal((await store.read_message(writer.message_id)).parts[0].text, "abc");
  await writer.fail("test completed");
});

test("工具调用、审批、结果和后续文本保持 canonical 顺序", async () => {
  const { recorder, store } = await create_recorder("tool-order-test");
  const interactions = new SessionInteractions({
    session_id: "tool-order-test",
    messages: recorder,
  });
  const approval_adapter = new SessionShellApprovalAdapter({
    session_id: "tool-order-test",
    interactions,
  });
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  await write_text(writer, "text-1", "before");
  await write_tool_call(writer, {
    content_id: "tool-1",
    tool_call_id: "call-1",
    tool_name: "shell_exec",
    input_delta: '{"cmd":"pwd"}',
    tool_input: { cmd: "pwd" },
  });

  const approval = await approval_adapter.request({
    shell_id: "shell-1",
    tool_call_id: "call-1",
    tool_name: "shell_exec",
    session_id: "tool-order-test",
    turn_id: "turn-1",
    command: "pwd",
    cwd: "/workspace",
    reason: "Inspect directory",
    operation: "exec",
    timeout_ms: 60_000,
  });
  await interactions.respond({
    interaction_id: approval.approval_id,
    response: {
      type: "approval",
      outcome: "resolved",
      payload: { decision: "approved" },
    },
  });
  assert.equal(await approval.decision, "approved");

  await writer.apply_tool_result({
    tool_call_id: "call-1",
    tool_name: "shell_exec",
    succeeded: true,
    output: { count: 1 },
  });
  await write_text(writer, "text-2", "after");
  await writer.finish_step([
    { part_id: "text-1", sequence: 1, type: "text", text: "before", state: "done" },
    {
      part_id: "tool-1",
      sequence: 2,
      type: "tool",
      tool_call_id: "call-1",
      tool_name: "shell_exec",
      state: "completed",
      input: { cmd: "pwd" },
      output: { count: 1 },
    },
    { part_id: "text-2", sequence: 3, type: "text", text: "after", state: "done" },
  ]);
  await writer.complete();

  const assistant = (await store.list_messages())[0];
  assert.deepEqual(
    assistant.parts.map((part) => part.type),
    ["text", "tool", "interaction", "text"],
  );
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2, 3, 4]);
  assert.equal(assistant.parts[1].state, "completed");
  assert.deepEqual(assistant.parts[1].output, { count: 1 });
});

test("reasoning signature 经 canonical Message 保留到模型历史", async () => {
  const { recorder } = await create_recorder("reasoning-signature-test");
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  await writer.apply_model_event({ type: "reasoning_start", content_id: "reasoning-1" });
  await writer.apply_model_event({
    type: "reasoning_delta",
    content_id: "reasoning-1",
    delta: "分析过程",
  });
  await writer.apply_model_event({
    type: "reasoning_finish",
    content_id: "reasoning-1",
    signature: "opaque-signature",
  });
  await writer.finish_step([{
    part_id: "reasoning-1",
    sequence: 1,
    type: "reasoning",
    text: "分析过程",
    state: "done",
    reasoning_signature: "opaque-signature",
  }]);
  await writer.complete();

  const snapshot = await recorder.list_history_messages();
  const model_messages = await session_messages_to_model_messages(snapshot);
  assert.equal(snapshot[0].parts[0].reasoning_signature, "opaque-signature");
  assert.equal(model_messages[0].content[0].signature, "opaque-signature");
});

test("多个模型 Step 可复用 content_id 且追加到同一 Assistant Message", async () => {
  const { recorder } = await create_recorder("reused-content-id-test");
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });

  await writer.begin_step();
  await write_text(writer, "text-1", "first");
  await writer.finish_step([{
    part_id: "first",
    sequence: 1,
    type: "text",
    text: "first",
    state: "done",
  }]);

  await writer.begin_step();
  await write_text(writer, "text-1", "second");
  await writer.finish_step([{
    part_id: "second",
    sequence: 1,
    type: "text",
    text: "second",
    state: "done",
  }]);
  await writer.complete();

  const assistant = (await recorder.list_history_messages()).find(
    (message) => message.message_id === writer.message_id,
  );
  assert.deepEqual(assistant.parts.map((part) => part.text), ["first", "second"]);
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2]);
});

test("工具执行等待对应标准流事件创建 canonical Part", async () => {
  const { recorder } = await create_recorder("tool-gate-test");
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  let prepared = false;
  const preparation = writer.prepare_tool_input({
    tool_call_id: "call-1",
    tool_name: "lookup",
    input: { query: "downcity" },
  }).then(() => {
    prepared = true;
  });
  await Promise.resolve();
  assert.equal(prepared, false);

  await writer.apply_model_event({
    type: "tool_call_start",
    content_id: "tool-1",
    tool_call_id: "call-1",
    tool_name: "lookup",
  });
  await preparation;
  assert.equal(prepared, true);
  assert.equal(recorder.get_message(writer.message_id).parts[0].state, "ready");
  await writer.abort_step();
  await writer.fail("stopped");
});

test("Step 最终快照不能补造未经过模型事件的 Part", async () => {
  const { recorder } = await create_recorder("snapshot-mismatch-test");
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  await write_text(writer, "text-1", "final");
  await assert.rejects(writer.finish_step([
    {
      part_id: "tool-1",
      sequence: 1,
      type: "tool",
      tool_call_id: "call-1",
      tool_name: "lookup",
      state: "completed",
      input: {},
      output: "ok",
    },
    { part_id: "text-1", sequence: 2, type: "text", text: "final", state: "done" },
  ]), /snapshot mismatch/);
  await writer.abort_step();
  await writer.fail("invalid stream");
});

test("Tool 输入检查点持久化失败时终止工具执行", async () => {
  const { recorder, store } = await create_recorder(
    "tool-write-failure-test",
    (options) => new FailingAssistantMessageStore(options),
  );
  const writer = await recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  await writer.apply_model_event({
    type: "tool_call_start",
    content_id: "tool-1",
    tool_call_id: "call-1",
    tool_name: "lookup",
  });
  store.fail_next_assistant_write("tool write failed");
  await assert.rejects(writer.prepare_tool_input({
    tool_call_id: "call-1",
    tool_name: "lookup",
    input: {},
  }), /tool write failed/);
  await writer.abort_step();
  await writer.fail("write failed");
});

test("重启时收口流式 Assistant 和运行中 Action", async () => {
  const session_id = "restart-recovery-test";
  const harness = await create_recorder(session_id);
  const writer = await harness.recorder.open_agent_message({ turn_id: "turn-1" });
  await writer.begin_step();
  await writer.apply_model_event({ type: "text_start", content_id: "text-1" });
  await writer.apply_model_event({ type: "text_delta", content_id: "text-1", delta: "partial" });
  await harness.recorder.open_action_part({
    message_id: "action-1",
    turn_id: "turn-1",
    action_type: "test",
    title: "Running action",
  });
  assert.equal(
    (await harness.store.read_message("action-1")).state,
    "streaming",
  );

  await harness.store.dispose();
  const restarted_store = new SqliteSessionStorage({
    files: harness.files,
    session_id,
    agent_id: "test-agent",
    origin: { type: "chat" },
    database_path: harness.database_path,
    database_location: { type: "file" },
    attachments: {},
  });
  const restarted = new SessionMessages({
    session_id,
    store: restarted_store,
    attachment_store: restarted_store.attachments,
    publish: () => {},
  });
  await restarted.initialize();
  const page = await restarted.list_messages();
  const assistant = page.items.find((message) =>
    message.role === "agent" &&
    message.parts.some((part) => part.type === "error" && part.code === "runtime_interrupted")
  );
  const action = page.items.find((message) => message.role === "agent" && message.parts.some((part) => part.type === "action"));
  assert.equal(assistant.state, "done");
  assert.equal(assistant.parts.some((part) => part.type === "text"), false);
  assert.equal(assistant.parts.at(-1).type, "error");
  assert.equal(action.state, "done");
  assert.equal(action.parts.find((part) => part.type === "action")?.state, "failed");
});

test("Action 更新保留 identity 并只读取最新 revision", async () => {
  const { recorder } = await create_recorder("action-revision-test");
  const writer = await recorder.open_action_part({
    message_id: "action-1",
    turn_id: "turn-1",
    action_type: "deploy",
    title: "Deploying",
  });
  await writer.complete();
  const page = await recorder.list_messages();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].message_id, "action-1");
  assert.equal(page.items[0].revision, 2);
  assert.equal(page.items[0].state, "done");
  assert.equal(page.items[0].parts[0].type, "action");
  assert.equal(page.items[0].parts[0].state, "completed");
});

test("Adaptive Part Policy 可在单个 Agent Message 内建立摘要边界", async () => {
  const session_id = "compact-model-history-test";
  const { recorder, store, root_path } = await create_recorder(session_id);
  await recorder.append_completed_agent_message({
    turn_id: "turn-1",
    parts: Array.from({ length: 6 }, (_, index) => ({
      part_id: `text-${String(index + 1)}`,
      sequence: index + 1,
      type: "text",
      text: `part ${String(index + 1)}`,
      state: "done",
    })),
  });
  let summary_prompt = "";
  const model = new MockModelClient({
    modelId: "summary-model",
    doGenerate: async (options) => {
      summary_prompt = JSON.stringify(options.prompt);
      return {
        content: [{ type: "text", text: "summary checkpoint" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1 },
          outputTokens: { total: 1 },
        },
      };
    },
  });
  const policy = new AdaptivePartContextPolicy();
  const policy_storage = store.composer_storage(policy.name);
  await policy.initialize({ storage: policy_storage });
  assert.equal(await policy.recover({ storage: policy_storage, model, reason: "provider_context_limit", project_root: root_path }), true);
  assert.match(summary_prompt, /part 1/);
  assert.match(summary_prompt, /part 3/);
  assert.doesNotMatch(summary_prompt, /part 4/);
  const context = await policy.resolve({ storage: policy_storage, project_root: root_path });
  const canonical = await recorder.list_history_messages();
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].parts.length, 6);
  const model_messages = context.messages;
  assert.equal(context.system_blocks[0].source, "session");
  assert.match(context.system_blocks[0].content, /<session-context-summary>/);
  assert.equal(model_messages.length, 1);
  assert.deepEqual(model_messages[0].content.map((part) => part.text), [
    "part 4",
    "part 5",
    "part 6",
  ]);
});

test("Adaptive Part Policy 可压缩单个占满上下文的 Part", async () => {
  const session_id = "compact-single-large-part-test";
  const { recorder, store, root_path } = await create_recorder(session_id);
  await recorder.append_completed_agent_message({
    turn_id: "turn-1",
    parts: [{
      part_id: "large-text",
      sequence: 1,
      type: "text",
      text: "large context ".repeat(1_000),
      state: "done",
    }],
  });
  const model = new MockModelClient({
    modelId: "single-large-part-summary-model",
    doGenerate: async () => ({
      content: [{ type: "text", text: "single part summary" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1 },
        outputTokens: { total: 1 },
      },
    }),
  });
  const policy = new AdaptivePartContextPolicy();
  const policy_storage = store.composer_storage(policy.name);
  await policy.initialize({ storage: policy_storage });

  assert.equal(await policy.recover({
    storage: policy_storage,
    model,
    reason: "provider_context_limit",
    project_root: root_path,
  }), true);
  const context = await policy.resolve({
    storage: policy_storage,
    project_root: root_path,
  });
  assert.equal(context.messages.length, 0);
  assert.match(context.system_blocks[0].content, /single part summary/);
});

test("内部上下文读取不会被 500 条 UI 分页边界截断", async () => {
  const session_id = "large-context-test";
  const { recorder } = await create_recorder(session_id);
  for (let sequence = 1; sequence <= 505; sequence += 1) {
    await recorder.append_user_message({
      message_id: `user-${String(sequence)}`,
      turn_id: `turn-${String(sequence)}`,
      parts: create_user_message(session_id, sequence).parts,
    });
  }
  const snapshot = await recorder.list_history_messages();
  const model_messages = await session_messages_to_model_messages(snapshot);
  assert.equal(snapshot.length, 505);
  assert.equal(model_messages.length, 505);
  assert.equal(model_messages.at(-1).content[0].text, "message 505");
});
