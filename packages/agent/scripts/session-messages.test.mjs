/**
 * @file 验证 SessionMessages 的 Message 快照、Assistant 草稿与实时事件一致性。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { JsonlSessionMessageStore } from "../bin/workspace/store/JsonlSessionMessageStore.js";
import { LocalFileSystem } from "@downcity/workspace";
import { SessionMessages } from "../bin/session/SessionMessages.js";
import { SessionInteractions } from "../bin/session/control/SessionInteractions.js";
import { SessionShellApprovalAdapter } from "../bin/session/execution/tools/SessionShellApprovalAdapter.js";
import { compose_session_compaction } from "../bin/session/messages/SessionMessageCompaction.js";
import {
  from_ui_assistant_parts,
  from_ui_user_parts,
  to_executor_history,
  to_executor_ui_message,
} from "../bin/session/messages/SessionMessageCodec.js";
import { convertToModelMessages } from "ai";
import { MockLanguageModelV3 } from "ai/test";

/** 可暂停一次 Assistant 草稿写入，用于稳定复现并发写入顺序。 */
class PausingAssistantMessageStore extends JsonlSessionMessageStore {
  next_assistant_write = null;

  pause_next_assistant_write() {
    let mark_started;
    let release;
    const started = new Promise((resolve) => {
      mark_started = resolve;
    });
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    this.next_assistant_write = { mark_started, wait };
    return { started, release };
  }

  async write_assistant_message(message) {
    const pending = this.next_assistant_write;
    if (pending) {
      this.next_assistant_write = null;
      pending.mark_started();
      await pending.wait;
    }
    await super.write_assistant_message(message);
  }
}

/** 可让下一次 Assistant 草稿更新失败，用于验证持久化失败边界。 */
class FailingAssistantMessageStore extends JsonlSessionMessageStore {
  next_assistant_error = null;

  fail_next_assistant_write(message) {
    this.next_assistant_error = new Error(message);
  }

  async write_assistant_message(message) {
    const error = this.next_assistant_error;
    if (error) {
      this.next_assistant_error = null;
      throw error;
    }
    await super.write_assistant_message(message);
  }
}

async function create_recorder(
  session_id = "session-recorder-test",
  create_store = (options) => new JsonlSessionMessageStore(options),
) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-recorder-"));
  const file_path = path.join(root_path, "active.jsonl");
  const assistant_message_file_path = path.join(root_path, "assistant_message.json");
  const events = [];
  const files = new LocalFileSystem(root_path);
  const store = create_store({ files, session_id, file_path });
  const recorder = new SessionMessages({
    session_id,
    store,
    publish: (mutation) => events.push(mutation),
  });
  await recorder.initialize();
  return { recorder, store, events, files, file_path, assistant_message_file_path };
}

async function read_jsonl(file_path) {
  const raw = await fs.readFile(file_path, "utf8");
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function create_seeded_recorder(session_id, messages) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-seeded-"));
  const file_path = path.join(root_path, "active.jsonl");
  await fs.writeFile(
    file_path,
    `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    "utf8",
  );
  const recorder = new SessionMessages({
    session_id,
    store: new JsonlSessionMessageStore({
      files: new LocalFileSystem(root_path),
      session_id,
      file_path,
    }),
    publish: () => {},
  });
  await recorder.initialize();
  return { recorder, file_path };
}

async function compact_messages(recorder, session_id, model) {
  const plan = await compose_session_compaction({
    session_id,
    snapshot: await recorder.context_snapshot(),
    model,
  });
  if (!plan) return false;
  await recorder.compact_active({
    through_sequence: plan.through_sequence,
    summary: plan.summary,
  });
  return true;
}

function create_seeded_user_message(session_id, sequence) {
  return {
    message_id: `user-${String(sequence)}`,
    session_id,
    turn_id: `turn-${String(sequence)}`,
    sequence,
    revision: 1,
    visibility: "visible",
    created_at: sequence,
    updated_at: sequence,
    type: "user",
    input_type: "prompt",
    parts: [{
      part_id: `user-text-${String(sequence)}`,
      type: "text",
      text: `message ${String(sequence)}`,
      state: "done",
    }],
  };
}

test("delta 只更新 Assistant 草稿，完成后才写入 active.jsonl", async () => {
  const { recorder, events, file_path, assistant_message_file_path } = await create_recorder();
  await recorder.append_user_message({
    turn_id: "turn-1",
    input_type: "prompt",
    parts: [{ part_id: "user-text-1", type: "text", text: "你好", state: "done" }],
  });
  const writer = await recorder.open_assistant_message({ turn_id: "turn-1" });
  await writer.apply_chunk({ type: "text-start", id: "text-1" });
  await writer.apply_chunk({ type: "text-delta", id: "text-1", delta: "你" });
  await writer.apply_chunk({ type: "text-delta", id: "text-1", delta: "好" });

  const history_during_stream = await read_jsonl(file_path);
  const draft = JSON.parse(await fs.readFile(assistant_message_file_path, "utf8"));
  assert.equal(history_during_stream.length, 1);
  assert.equal(history_during_stream[0].type, "user");
  assert.equal(draft.type, "assistant");
  assert.equal(draft.parts[0].text, "你好");
  assert.equal(draft.parts[0].sequence, 1);

  await writer.apply_chunk({ type: "text-end", id: "text-1" });
  await writer.complete();

  const history = await read_jsonl(file_path);
  assert.deepEqual(history.map((message) => message.type), ["user", "assistant"]);
  assert.equal(history[1].parts[0].text, "你好");
  assert.equal(await fs.stat(assistant_message_file_path).then(() => true).catch(() => false), false);
  assert.deepEqual(events.map((event) => `${event.variant}:${event.type}`), [
    "message:user",
    "message:assistant",
    "part:text",
    "delta:text",
    "delta:text",
    "part:text",
    "message:assistant",
  ]);
  assert.equal(history.some((value) => "variant" in value), false);
});

test("Tool Runtime 在文本中间保持输入、审批和输出的确定顺序", async () => {
  const { recorder, events, file_path } = await create_recorder("tool-order-test");
  const interactions = new SessionInteractions({
    session_id: "tool-order-test",
    messages: recorder,
  });
  const approval_adapter = new SessionShellApprovalAdapter({
    session_id: "tool-order-test",
    interactions,
  });
  const writer = await recorder.open_assistant_message({ turn_id: "turn-1" });
  await writer.apply_chunk({ type: "text-start", id: "text-1" });
  await writer.apply_chunk({ type: "text-delta", id: "text-1", delta: "before" });
  await writer.apply_chunk({ type: "text-end", id: "text-1" });
  await writer.apply_chunk({ type: "tool-input-start", toolCallId: "call-1", toolName: "shell_exec" });
  await writer.apply_chunk({
    type: "tool-input-delta",
    toolCallId: "call-1",
    inputTextDelta: '{"cmd":"',
  });
  await writer.apply_chunk({
    type: "tool-input-delta",
    toolCallId: "call-1",
    inputTextDelta: 'pwd"}',
  });
  await writer.apply_chunk({
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "shell_exec",
    input: { cmd: "pwd", sandbox: "unrestricted", reason: "Inspect directory" },
  });
  assert.equal(recorder.get_message(writer.message_id).parts[1].state, "ready");
  const approval_handle = await approval_adapter.request({
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
  assert.equal(recorder.get_message(writer.message_id).parts[1].state, "waiting-user");
  await interactions.respond({
    interaction_id: approval_handle.approval_id,
    response: { kind: "approval", decision: "approved" },
  });
  assert.equal(await approval_handle.decision, "approved");
  await writer.apply_chunk({ type: "text-start", id: "text-2" });
  await writer.apply_chunk({ type: "text-delta", id: "text-2", delta: "after" });
  await writer.apply_chunk({ type: "text-end", id: "text-2" });
  await writer.apply_chunk({ type: "tool-output-available", toolCallId: "call-1", output: { count: 1 } });
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  assert.deepEqual(assistant.parts.map((part) => part.type), ["text", "tool", "interaction", "text"]);
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2, 3, 4]);
  assert.equal(assistant.parts[1].state, "completed");
  assert.equal(assistant.parts[1].input_text, '{"cmd":"pwd"}');
  assert.deepEqual(assistant.parts[1].output, { count: 1 });
  assert.deepEqual(
    events
      .filter((event) => event.variant === "delta" && event.type === "tool_input")
      .map((event) => [event.tool_call_id, event.delta]),
    [
      ["call-1", '{"cmd":"'],
      ["call-1", 'pwd"}'],
    ],
  );
  assert.deepEqual(
    events
      .filter((event) => event.variant === "part" && event.type === "tool")
      .map((event) => [event.part.sequence, event.part.state]),
    [
      [2, "input-streaming"],
      [2, "ready"],
      [2, "waiting-user"],
      [2, "running"],
      [2, "completed"],
    ],
  );
});

test("Streaming Tool Provider metadata 在输入和输出状态间完整保留", async () => {
  const { recorder, file_path } = await create_recorder("tool-provider-metadata-test");
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-provider-metadata",
  });
  await writer.begin_step();
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call_1",
    toolName: "lookup",
    providerMetadata: { openai: { itemId: "fc_start" } },
  });
  await writer.prepare_tool_input({
    tool_call_id: "call_1",
    tool_name: "lookup",
    input: { q: "x" },
  });
  await writer.apply_chunk({
    type: "tool-input-available",
    toolCallId: "call_1",
    toolName: "lookup",
    input: { q: "x" },
    providerExecuted: true,
    providerMetadata: { openai: { itemId: "fc_1" } },
  });
  await writer.apply_chunk({
    type: "tool-output-available",
    toolCallId: "call_1",
    output: "ok",
    providerExecuted: true,
    providerMetadata: { openai: { resultId: "result_1" } },
  });
  await writer.finish_step([{
    part_id: "call_1",
    sequence: 1,
    type: "tool",
    tool_call_id: "call_1",
    tool_name: "lookup",
    state: "completed",
    input: { q: "x" },
    output: "ok",
    provider_executed: true,
    call_provider_metadata: { openai: { itemId: "fc_final" } },
  }]);
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  const tool_part = assistant.parts.find((part) => part.type === "tool");
  assert.deepEqual(tool_part.call_provider_metadata, {
    openai: { itemId: "fc_final" },
  });
  assert.deepEqual(tool_part.result_provider_metadata, {
    openai: { resultId: "result_1" },
  });
  assert.equal(tool_part.provider_executed, true);
  assert.equal(tool_part.state, "completed");
});

test("AI SDK 流式 metadata、source、data、step 和审批状态完整持久化", async () => {
  const { recorder, file_path } = await create_recorder("ui-chunk-semantics-test");
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-ui-chunks",
  });
  await writer.apply_chunk({
    type: "text-start",
    id: "text_1",
    providerMetadata: { openai: { itemId: "text_start" } },
  });
  await writer.apply_chunk({ type: "text-delta", id: "text_1", delta: "hello" });
  await writer.apply_chunk({
    type: "text-end",
    id: "text_1",
    providerMetadata: { openai: { itemId: "text_end" } },
  });
  await writer.apply_chunk({ type: "reasoning-start", id: "reasoning_1" });
  await writer.apply_chunk({
    type: "reasoning-delta",
    id: "reasoning_1",
    delta: "think",
    providerMetadata: { openai: { itemId: "reasoning_delta" } },
  });
  await writer.apply_chunk({ type: "reasoning-end", id: "reasoning_1" });
  await writer.apply_chunk({
    type: "source-url",
    sourceId: "source_1",
    url: "https://example.com/old",
  });
  await writer.apply_chunk({
    type: "source-url",
    sourceId: "source_1",
    url: "https://example.com/new",
    title: "Updated source",
    providerMetadata: { openai: { itemId: "source_item" } },
  });
  await writer.apply_chunk({
    type: "data-progress",
    id: "progress_1",
    data: { percent: 10 },
  });
  await writer.apply_chunk({
    type: "data-progress",
    id: "progress_1",
    data: { percent: 90 },
  });
  await writer.apply_chunk({
    type: "data-progress",
    id: "transient_1",
    data: { percent: 100 },
    transient: true,
  });
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call_approval",
    toolName: "lookup",
    title: "Lookup",
    dynamic: true,
    providerMetadata: { openai: { itemId: "fc_approval" } },
  });
  await writer.apply_chunk({
    type: "tool-input-available",
    toolCallId: "call_approval",
    toolName: "lookup",
    input: { q: "downcity" },
    toolMetadata: { category: "search" },
  });
  await writer.apply_chunk({
    type: "tool-approval-request",
    approvalId: "approval_stream_1",
    toolCallId: "call_approval",
  });
  await writer.apply_chunk({
    type: "tool-output-denied",
    toolCallId: "call_approval",
  });
  await writer.apply_chunk({
    type: "file",
    mediaType: "image/png",
    url: "https://example.com/output.png",
    providerMetadata: { openai: { fileId: "output_file" } },
  });
  await writer.apply_chunk({ type: "start-step" });
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  assert.deepEqual(assistant.parts.map((part) => part.type), [
    "text",
    "reasoning",
    "source",
    "data",
    "tool",
    "file",
    "step-start",
  ]);
  assert.deepEqual(assistant.parts[0].provider_metadata, {
    openai: { itemId: "text_end" },
  });
  assert.deepEqual(assistant.parts[1].provider_metadata, {
    openai: { itemId: "reasoning_delta" },
  });
  assert.equal(assistant.parts[2].url, "https://example.com/new");
  assert.equal(assistant.parts[2].title, "Updated source");
  assert.deepEqual(assistant.parts[3].data, { percent: 90 });
  const tool_part = assistant.parts[4];
  assert.equal(tool_part.state, "failed");
  assert.equal(tool_part.title, "Lookup");
  assert.equal(tool_part.dynamic, true);
  assert.deepEqual(tool_part.tool_metadata, { category: "search" });
  assert.equal("approval" in tool_part, false);
  assert.equal(
    assistant.parts.some((part) => part.type === "data" && part.data_id === "transient_1"),
    false,
  );
});

test("UI Tool Provider metadata 经 Session roundtrip 后恢复为 ModelMessage providerOptions", async () => {
  const parts = from_ui_assistant_parts([{
    type: "dynamic-tool",
    toolName: "lookup",
    toolCallId: "call_1",
    state: "output-available",
    input: { q: "x" },
    output: "ok",
    providerExecuted: false,
    callProviderMetadata: { openai: { itemId: "fc_1" } },
    resultProviderMetadata: { openai: { resultId: "result_1" } },
  }]);
  assert.deepEqual(parts[0].call_provider_metadata, {
    openai: { itemId: "fc_1" },
  });
  assert.deepEqual(parts[0].result_provider_metadata, {
    openai: { resultId: "result_1" },
  });
  assert.equal(parts[0].provider_executed, false);

  const restored = to_executor_ui_message({
    message_id: "assistant_1",
    session_id: "session_1",
    turn_id: "turn_1",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    type: "assistant",
    kind: "normal",
    status: "completed",
    parts,
  });
  assert.deepEqual(restored.parts[0].callProviderMetadata, {
    openai: { itemId: "fc_1" },
  });
  assert.deepEqual(restored.parts[0].resultProviderMetadata, {
    openai: { resultId: "result_1" },
  });
  assert.equal(restored.parts[0].providerExecuted, false);

  const model_messages = await convertToModelMessages([restored]);
  const model_parts = model_messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content : []
  );
  const tool_call = model_parts.find((part) => part.type === "tool-call");
  const tool_result = model_parts.find((part) => part.type === "tool-result");
  assert.equal(tool_call.toolCallId, "call_1");
  assert.deepEqual(tool_call.providerOptions, {
    openai: { itemId: "fc_1" },
  });
  assert.deepEqual(tool_result.providerOptions, {
    openai: { itemId: "fc_1" },
  });

  const typed_parts = from_ui_assistant_parts([{
    type: "tool-lookup",
    toolCallId: "call_2",
    state: "input-available",
    input: { q: "typed" },
    providerExecuted: true,
    callProviderMetadata: { openai: { itemId: "fc_2" } },
  }]);
  assert.equal(typed_parts[0].tool_name, "lookup");
  assert.equal(typed_parts[0].provider_executed, true);
  assert.deepEqual(typed_parts[0].call_provider_metadata, {
    openai: { itemId: "fc_2" },
  });

  const provider_executed = to_executor_ui_message({
    message_id: "assistant_2",
    session_id: "session_1",
    turn_id: "turn_1",
    sequence: 2,
    revision: 1,
    visibility: "visible",
    created_at: 2,
    updated_at: 2,
    type: "assistant",
    kind: "normal",
    status: "completed",
    parts: from_ui_assistant_parts([{
      type: "dynamic-tool",
      toolName: "provider_lookup",
      toolCallId: "call_3",
      state: "output-available",
      input: { q: "provider" },
      output: "provider result",
      providerExecuted: true,
      callProviderMetadata: { openai: { itemId: "fc_3" } },
      resultProviderMetadata: { openai: { resultId: "result_3" } },
    }]),
  });
  const provider_model_messages = await convertToModelMessages([
    provider_executed,
  ]);
  const provider_result = provider_model_messages
    .flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .find((part) => part.type === "tool-result");
  assert.deepEqual(provider_result.providerOptions, {
    openai: { resultId: "result_3" },
  });
});

test("SessionMessage 保留稳定语义并归一化 AI SDK 原生审批字段", () => {
  const user_parts = [
    {
      type: "text",
      text: "分析附件",
      state: "done",
      providerMetadata: { openai: { itemId: "user_text_1" } },
    },
    {
      type: "file",
      mediaType: "image/png",
      url: "https://example.com/input.png",
      filename: "input.png",
      providerMetadata: { openai: { fileId: "file_1" } },
    },
    {
      type: "data-preferences",
      id: "preferences_1",
      data: { locale: "zh-CN" },
    },
  ];
  const restored_user = to_executor_ui_message({
    message_id: "user_roundtrip",
    session_id: "session_roundtrip",
    turn_id: "turn_roundtrip",
    sequence: 1,
    revision: 1,
    visibility: "visible",
    created_at: 1,
    updated_at: 1,
    type: "user",
    input_type: "prompt",
    parts: from_ui_user_parts(user_parts),
  });
  assert.deepEqual(restored_user.parts, user_parts);

  const assistant_parts = [
    {
      type: "text",
      text: "正在处理",
      state: "streaming",
      providerMetadata: { openai: { itemId: "msg_1" } },
    },
    {
      type: "reasoning",
      text: "先读取来源",
      state: "done",
      providerMetadata: { openai: { itemId: "reasoning_1" } },
    },
    {
      type: "file",
      mediaType: "application/pdf",
      url: "https://example.com/report.pdf",
      filename: "report.pdf",
      providerMetadata: { openai: { fileId: "file_2" } },
    },
    {
      type: "source-url",
      sourceId: "source_url_1",
      url: "https://example.com/source",
      title: "Example source",
      providerMetadata: { openai: { itemId: "source_1" } },
    },
    {
      type: "source-document",
      sourceId: "source_document_1",
      mediaType: "application/pdf",
      title: "Source document",
      filename: "source.pdf",
      providerMetadata: { openai: { itemId: "source_2" } },
    },
    { type: "step-start" },
    {
      type: "data-progress",
      id: "progress_1",
      data: { percent: 80 },
    },
    {
      type: "dynamic-tool",
      toolName: "lookup",
      toolCallId: "call_streaming",
      state: "input-streaming",
      title: "Lookup",
      toolMetadata: { category: "search" },
      providerExecuted: false,
      callProviderMetadata: { openai: { itemId: "fc_streaming" } },
    },
    {
      type: "tool-fetch",
      toolCallId: "call_ready",
      state: "input-available",
      input: { url: "https://example.com" },
      title: "Fetch",
      toolMetadata: { category: "network" },
      providerExecuted: true,
      callProviderMetadata: { openai: { itemId: "fc_ready" } },
    },
    {
      type: "dynamic-tool",
      toolName: "shell_exec",
      toolCallId: "call_approval",
      state: "approval-requested",
      input: { cmd: "pwd" },
      approval: { id: "approval_1" },
    },
    {
      type: "tool-shell_exec",
      toolCallId: "call_responded",
      state: "approval-responded",
      input: { cmd: "ls" },
      approval: { id: "approval_2", approved: true, reason: "Allowed" },
    },
    {
      type: "dynamic-tool",
      toolName: "lookup",
      toolCallId: "call_completed",
      state: "output-available",
      input: { q: "downcity" },
      output: { count: 1 },
      preliminary: true,
      approval: { id: "approval_3", approved: true, reason: "Allowed" },
      callProviderMetadata: { openai: { itemId: "fc_completed" } },
      resultProviderMetadata: { openai: { itemId: "result_completed" } },
    },
    {
      type: "dynamic-tool",
      toolName: "parse",
      toolCallId: "call_error",
      state: "output-error",
      input: undefined,
      rawInput: "{invalid",
      errorText: "Invalid input",
      approval: { id: "approval_4", approved: true },
      resultProviderMetadata: { openai: { itemId: "result_error" } },
    },
    {
      type: "dynamic-tool",
      toolName: "delete",
      toolCallId: "call_denied",
      state: "output-denied",
      input: { path: "/tmp/a" },
      approval: { id: "approval_5", approved: false, reason: "Denied" },
    },
  ];
  const canonical_parts = from_ui_assistant_parts(assistant_parts);
  const restored_assistant = to_executor_ui_message({
    message_id: "assistant_roundtrip",
    session_id: "session_roundtrip",
    turn_id: "turn_roundtrip",
    sequence: 2,
    revision: 1,
    visibility: "visible",
    created_at: 2,
    updated_at: 2,
    type: "assistant",
    kind: "normal",
    status: "streaming",
    parts: canonical_parts,
  });
  assert.deepEqual(restored_assistant.parts.slice(0, 9), assistant_parts.slice(0, 9));
  const restored_tools = restored_assistant.parts.slice(9);
  assert.deepEqual(
    restored_tools.map((part) => part.state),
    ["input-available", "input-available", "output-available", "output-error", "output-error"],
  );
  assert.equal(restored_tools.every((part) => !("approval" in part)), true);
  assert.equal(canonical_parts.find((part) => part.tool_call_id === "call_ready").dynamic, false);
  assert.equal(canonical_parts.find((part) => part.tool_call_id === "call_completed").dynamic, true);
});

test("Session Interaction 只接受已经准备完整输入的 Tool", async () => {
  const { recorder, events } = await create_recorder("tool-ready-barrier-test");
  const interactions = new SessionInteractions({
    session_id: "tool-ready-barrier-test",
    messages: recorder,
  });
  const approval_adapter = new SessionShellApprovalAdapter({
    session_id: "tool-ready-barrier-test",
    interactions,
  });
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-ready-barrier",
  });
  const approval_input = {
    shell_id: "shell-ready-barrier",
    tool_call_id: "call-ready-barrier",
    tool_name: "shell_exec",
    session_id: "tool-ready-barrier-test",
    turn_id: "turn-ready-barrier",
    command: "ls -la /Users/example/Desktop",
    cwd: "/workspace",
    reason: "Inspect requested desktop files",
    operation: "exec",
    timeout_ms: 60_000,
  };
  await assert.rejects(
    approval_adapter.request(approval_input),
    /Streaming Tool Part not found/,
  );
  assert.equal(interactions.list().length, 0);

  const tool_input_ready = writer.prepare_tool_input({
    tool_call_id: "call-ready-barrier",
    tool_name: "shell_exec",
    input: {
      cmd: "ls -la /Users/example/Desktop",
      sandbox: "unrestricted",
      reason: "Inspect requested desktop files",
    },
  });
  await writer.flush();
  assert.deepEqual(recorder.get_message(writer.message_id).parts, []);
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call-ready-barrier",
    toolName: "shell_exec",
  });
  await tool_input_ready;
  const approval_handle = await approval_adapter.request(approval_input);

  const tool = recorder.get_message(writer.message_id).parts[0];
  const interaction = recorder.get_message(writer.message_id).parts[1];
  assert.equal(tool.state, "waiting-user");
  assert.equal(interaction.interaction_id, approval_handle.approval_id);
  assert.equal(interaction.request.command, approval_input.command);
  assert.equal(tool.input.cmd, "ls -la /Users/example/Desktop");
  await interactions.respond({
    interaction_id: approval_handle.approval_id,
    response: { kind: "approval", decision: "denied" },
  });
  assert.equal(await approval_handle.decision, "denied");
  await writer.apply_chunk({
    type: "tool-output-available",
    toolCallId: "call-ready-barrier",
    output: { success: false, approval_status: "denied" },
  });
  assert.equal(recorder.get_message(writer.message_id).parts[0].state, "failed");
  assert.deepEqual(
    events
      .filter((event) => event.variant === "part" && event.type === "tool")
      .map((event) => event.part.state),
    ["input-streaming", "ready", "waiting-user", "failed"],
  );
});

test("Question Interaction 校验文本、单选与多选回答后恢复执行", async () => {
  const { recorder } = await create_recorder("question-interaction-test");
  const interactions = new SessionInteractions({
    session_id: "question-interaction-test",
    messages: recorder,
  });
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-question",
  });
  const handle = await interactions.request({
    interaction_id: "interaction-question",
    turn_id: "turn-question",
    kind: "question",
    source: { type: "execution" },
    title: "补充信息",
    questions: [
      { question_id: "name", prompt: "项目名称？", response_type: "text" },
      {
        question_id: "region",
        prompt: "部署区域？",
        response_type: "single_select",
        options: [{ value: "cn", label: "中国" }],
      },
      {
        question_id: "features",
        prompt: "启用能力？",
        response_type: "multi_select",
        options: [{ value: "search", label: "搜索" }],
      },
    ],
    created_at: Date.now(),
  });

  await assert.rejects(
    interactions.respond({
      interaction_id: handle.interaction_id,
      response: {
        kind: "question",
        answers: [{ question_id: "name", value: "Downcity" }],
      },
    }),
    /answer count mismatch/,
  );
  const result = await interactions.respond({
    interaction_id: handle.interaction_id,
    response: {
      kind: "question",
      answers: [
        { question_id: "name", value: "Downcity" },
        { question_id: "region", value: "cn" },
        { question_id: "features", value: ["search"] },
      ],
    },
  });

  assert.deepEqual(await handle.result, result);
  const interaction = recorder.get_message(writer.message_id).parts[0];
  assert.equal(interaction.type, "interaction");
  assert.equal(interaction.status, "resolved");
  assert.deepEqual(interaction.response, result.response);
});

test("取消 Interaction 先原子关闭 Tool 与 Interaction，再兑现等待结果", async () => {
  const { recorder } = await create_recorder("cancel-interaction-test");
  const interactions = new SessionInteractions({
    session_id: "cancel-interaction-test",
    messages: recorder,
  });
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-cancel",
  });
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call-cancel",
    toolName: "ask_user",
  });
  await writer.prepare_tool_input({
    tool_call_id: "call-cancel",
    tool_name: "ask_user",
    input: { prompt: "继续吗？" },
  });
  const handle = await interactions.request({
    interaction_id: "interaction-cancel",
    turn_id: "turn-cancel",
    kind: "question",
    source: {
      type: "tool",
      tool_call_id: "call-cancel",
      tool_name: "ask_user",
    },
    title: "确认",
    questions: [{ question_id: "continue", prompt: "继续吗？", response_type: "text" }],
    created_at: Date.now(),
  });

  await interactions.cancel_all("turn_stopped");
  assert.deepEqual(await handle.result, {
    status: "cancelled",
    interaction_id: "interaction-cancel",
    reason: "turn_stopped",
  });
  const parts = recorder.get_message(writer.message_id).parts;
  assert.equal(parts.find((part) => part.type === "tool").state, "failed");
  assert.equal(parts.find((part) => part.type === "interaction").status, "cancelled");
});

test("Interaction 超时后持久化 expired 终态", async () => {
  const { recorder } = await create_recorder("expire-interaction-test");
  const interactions = new SessionInteractions({
    session_id: "expire-interaction-test",
    messages: recorder,
  });
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-expire",
  });
  const handle = await interactions.request({
    interaction_id: "interaction-expire",
    turn_id: "turn-expire",
    kind: "question",
    source: { type: "execution" },
    title: "即将超时",
    questions: [{ question_id: "value", prompt: "请输入", response_type: "text" }],
    created_at: Date.now(),
    expires_at: Date.now() + 10,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await handle.result, {
    status: "expired",
    interaction_id: "interaction-expire",
  });
  assert.equal(recorder.get_message(writer.message_id).parts[0].status, "expired");
});

test("流式更新与 Interaction 共享 Assistant revision 写队列", async () => {
  const session_id = "approval-revision-queue-test";
  const { recorder, store, events } = await create_recorder(
    session_id,
    (options) => new PausingAssistantMessageStore(options),
  );
  const interactions = new SessionInteractions({ session_id, messages: recorder });
  const approval_adapter = new SessionShellApprovalAdapter({ session_id, interactions });
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-approval-race",
  });
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call-approval-race",
    toolName: "shell_exec",
  });
  await writer.prepare_tool_input({
    tool_call_id: "call-approval-race",
    tool_name: "shell_exec",
    input: {
      cmd: "ls -la ~",
      sandbox: "unrestricted",
      reason: "验证审批写入顺序",
    },
  });
  await writer.apply_chunk({ type: "text-start", id: "text-race" });
  await writer.apply_chunk({ type: "text-delta", id: "text-race", delta: "准备执行" });

  const gate = store.pause_next_assistant_write();
  const stream_write = writer.apply_chunk({
    type: "text-delta",
    id: "text-race",
    delta: "命令",
  });
  await gate.started;
  const approval_write = approval_adapter.request({
    shell_id: "shell-approval-race",
    tool_call_id: "call-approval-race",
    tool_name: "shell_exec",
    session_id,
    turn_id: "turn-approval-race",
    command: "ls -la ~",
    cwd: "/workspace",
    reason: "验证审批写入顺序",
    operation: "exec",
    timeout_ms: 60_000,
  });

  // 让 Approval 路径有机会进入写入；旧实现会在这里基于同一 revision 提交。
  await new Promise((resolve) => setImmediate(resolve));
  gate.release();
  const [, approval_handle] = await Promise.all([stream_write, approval_write]);

  const assistant = recorder.get_message(writer.message_id);
  const tool = assistant.parts.find((part) => part.type === "tool");
  const text_part = assistant.parts.find((part) => part.type === "text");
  assert.equal(assistant.revision, 7);
  const interaction = assistant.parts.find((part) => part.type === "interaction");
  assert.equal(tool.state, "waiting-user");
  assert.equal(interaction.interaction_id, approval_handle.approval_id);
  assert.equal(tool.input.cmd, "ls -la ~");
  assert.equal(text_part.text, "准备执行命令");
  assert.deepEqual(
    events
      .filter((event) => event.message_id === writer.message_id)
      .map((event) => event.revision),
    [1, 2, 3, 4, 5, 6, 7, 7],
  );
  assert.equal(
    events.some(
      (event) =>
        event.variant === "part" &&
        event.type === "interaction" &&
        event.part.status === "pending",
    ),
    true,
  );

  await interactions.respond({
    interaction_id: approval_handle.approval_id,
    response: { kind: "approval", decision: "denied" },
  });
  assert.equal(await approval_handle.decision, "denied");
});

test("不同模型 step 重复使用 Text chunk ID 时仍保持真实 Part 顺序", async () => {
  const { recorder, file_path } = await create_recorder("reused-text-id-order-test");
  const writer = await recorder.open_assistant_message({ turn_id: "turn-1" });

  await writer.begin_step();
  await writer.apply_chunk({ type: "text-start", id: "txt-0" });
  await writer.apply_chunk({ type: "text-delta", id: "txt-0", delta: "first" });
  await writer.apply_chunk({ type: "text-end", id: "txt-0" });
  await writer.apply_chunk({ type: "tool-input-start", toolCallId: "call-1", toolName: "search" });
  await writer.apply_chunk({
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "search",
    input: { query: "first" },
  });
  await writer.apply_chunk({ type: "tool-output-available", toolCallId: "call-1", output: "one" });
  await writer.finish_step([
    {
      part_id: "text-1",
      sequence: 1,
      type: "text",
      text: "first",
      state: "done",
    },
    {
      part_id: "call-1",
      sequence: 2,
      type: "tool",
      tool_call_id: "call-1",
      tool_name: "search",
      state: "completed",
      input: { query: "first" },
      output: "one",
    },
  ]);

  await writer.begin_step();
  await writer.apply_chunk({ type: "text-start", id: "txt-0" });
  await writer.apply_chunk({ type: "text-delta", id: "txt-0", delta: "second" });
  await writer.apply_chunk({ type: "text-end", id: "txt-0" });
  await writer.apply_chunk({ type: "tool-input-start", toolCallId: "call-2", toolName: "search" });
  await writer.apply_chunk({
    type: "tool-input-available",
    toolCallId: "call-2",
    toolName: "search",
    input: { query: "second" },
  });
  await writer.apply_chunk({ type: "tool-output-available", toolCallId: "call-2", output: "two" });
  await writer.finish_step([
    {
      part_id: "text-1",
      sequence: 1,
      type: "text",
      text: "second",
      state: "done",
    },
    {
      part_id: "call-2",
      sequence: 2,
      type: "tool",
      tool_call_id: "call-2",
      tool_name: "search",
      state: "completed",
      input: { query: "second" },
      output: "two",
    },
  ]);
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  assert.deepEqual(assistant.parts.map((part) => part.type), ["text", "tool", "text", "tool"]);
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2, 3, 4]);
  assert.deepEqual(
    assistant.parts.filter((part) => part.type === "text").map((part) => part.text),
    ["first", "second"],
  );
  assert.notEqual(assistant.parts[0].part_id, assistant.parts[2].part_id);
});

test("不同模型 step 重复 Source 与 Data ID 时创建独立 canonical Parts", async () => {
  const { recorder, file_path } = await create_recorder("reused-structured-id-order-test");
  const writer = await recorder.open_assistant_message({ turn_id: "turn-1" });

  for (const step of [1, 2]) {
    await writer.begin_step();
    await writer.apply_chunk({
      type: "source-url",
      sourceId: "source-1",
      url: `https://example.com/${step}`,
    });
    await writer.apply_chunk({
      type: "data-status",
      id: "status-1",
      data: { step },
    });
    await writer.finish_step([
      {
        part_id: "source-1",
        sequence: 1,
        type: "source",
        source_type: "url",
        source_id: "source-1",
        url: `https://example.com/${step}`,
      },
      {
        part_id: "data-1",
        sequence: 2,
        type: "data",
        data_type: "data-status",
        data: { step },
        data_id: "status-1",
      },
    ]);
  }
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  assert.deepEqual(
    assistant.parts.map((part) => part.type),
    ["source", "data", "source", "data"],
  );
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2, 3, 4]);
  assert.notEqual(assistant.parts[0].part_id, assistant.parts[2].part_id);
  assert.notEqual(assistant.parts[1].part_id, assistant.parts[3].part_id);
});

test("step 最终快照忽略没有 delta 的空 Text 与 Reasoning Part", async () => {
  const { recorder, file_path } = await create_recorder("empty-final-text-part-test");
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-empty-final-text",
  });

  await writer.begin_step();
  await writer.apply_chunk({ type: "text-start", id: "text-empty" });
  await writer.apply_chunk({ type: "text-delta", id: "text-empty", delta: "" });
  await writer.apply_chunk({ type: "text-end", id: "text-empty" });
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call-1",
    toolName: "find",
  });
  await writer.apply_chunk({
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "find",
    input: { glob: "**/*.mdx" },
  });
  await writer.apply_chunk({
    type: "tool-output-available",
    toolCallId: "call-1",
    output: ["document.mdx"],
  });
  await writer.apply_chunk({ type: "reasoning-start", id: "reasoning-empty" });
  await writer.apply_chunk({ type: "reasoning-end", id: "reasoning-empty" });
  const final_parts = from_ui_assistant_parts([
    {
      type: "text",
      text: "",
      state: "done",
    },
    {
      type: "tool-find",
      toolCallId: "call-1",
      state: "output-available",
      input: { glob: "**/*.mdx" },
      output: ["document.mdx"],
    },
    {
      type: "reasoning",
      text: "",
      state: "done",
    },
  ]);
  assert.deepEqual(final_parts.map((part) => part.type), ["tool"]);
  await writer.finish_step(final_parts);
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  assert.equal(assistant.status, "completed");
  assert.deepEqual(assistant.parts.map((part) => part.type), ["tool"]);
  assert.equal(assistant.parts[0].tool_call_id, "call-1");
});

test("空 Reasoning 携带 Provider metadata 时作为跨轮重放协议 Part 保存", async () => {
  const { recorder, file_path } = await create_recorder("empty-provider-reasoning-test");
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-empty-provider-reasoning",
  });
  const reasoning_metadata = {
    openai: { itemId: "rs_required" },
  };
  const message_metadata = {
    openai: { itemId: "msg_required", phase: "final_answer" },
  };

  await writer.begin_step();
  await writer.apply_chunk({
    type: "reasoning-start",
    id: "reasoning-empty-provider",
    providerMetadata: reasoning_metadata,
  });
  await writer.apply_chunk({
    type: "reasoning-end",
    id: "reasoning-empty-provider",
    providerMetadata: reasoning_metadata,
  });
  await writer.apply_chunk({ type: "text-start", id: "text-provider" });
  await writer.apply_chunk({
    type: "text-delta",
    id: "text-provider",
    delta: "完成",
  });
  await writer.apply_chunk({
    type: "text-end",
    id: "text-provider",
    providerMetadata: message_metadata,
  });
  const final_parts = from_ui_assistant_parts([
    {
      type: "reasoning",
      text: "",
      state: "done",
      providerMetadata: reasoning_metadata,
    },
    {
      type: "text",
      text: "完成",
      state: "done",
      providerMetadata: message_metadata,
    },
  ]);
  assert.deepEqual(final_parts.map((part) => part.type), ["reasoning", "text"]);
  await writer.finish_step(final_parts);
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  assert.deepEqual(assistant.parts.map((part) => part.type), ["reasoning", "text"]);
  assert.equal(assistant.parts[0].text, "");
  assert.deepEqual(assistant.parts[0].provider_metadata, reasoning_metadata);
  assert.deepEqual(assistant.parts[1].provider_metadata, message_metadata);

});

test("空 Text Start 不会抢占后续 Tool 的真实顺序", async () => {
  const { recorder, events, file_path } = await create_recorder("deferred-text-order-test");
  const writer = await recorder.open_assistant_message({ turn_id: "turn-1" });

  await writer.begin_step();
  await writer.apply_chunk({ type: "reasoning-start", id: "reasoning-0" });
  await writer.apply_chunk({ type: "reasoning-delta", id: "reasoning-0", delta: "先执行命令" });
  await writer.apply_chunk({ type: "reasoning-end", id: "reasoning-0" });
  await writer.apply_chunk({ type: "text-start", id: "text-0" });
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call-1",
    toolName: "shell_exec",
  });
  await writer.apply_chunk({
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "shell_exec",
    input: { cmd: "pwd" },
  });
  await writer.apply_chunk({
    type: "tool-output-available",
    toolCallId: "call-1",
    output: { success: true },
  });
  await writer.apply_chunk({ type: "text-delta", id: "text-0", delta: "命令执行完成" });
  await writer.apply_chunk({ type: "text-end", id: "text-0" });
  await writer.finish_step([
    {
      part_id: "reasoning-1",
      sequence: 1,
      type: "reasoning",
      text: "先执行命令",
      state: "done",
    },
    {
      part_id: "call-1",
      sequence: 2,
      type: "tool",
      tool_call_id: "call-1",
      tool_name: "shell_exec",
      state: "completed",
      input: { cmd: "pwd" },
      output: { success: true },
    },
    {
      part_id: "text-1",
      sequence: 3,
      type: "text",
      text: "命令执行完成",
      state: "done",
    },
  ]);
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  assert.deepEqual(assistant.parts.map((part) => part.type), ["reasoning", "tool", "text"]);
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2, 3]);
  assert.deepEqual(
    events
      .filter((event) => event.variant === "part")
      .map((event) => [event.type, event.part.sequence]),
    [
      ["reasoning", 1],
      ["reasoning", 1],
      ["tool", 2],
      ["tool", 2],
      ["tool", 2],
      ["text", 3],
      ["text", 3],
    ],
  );
});

test("Tool 执行先到时等待 stream 固定 canonical Part 顺序", async () => {
  const { recorder, file_path } = await create_recorder("pending-tool-input-order-test");
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-pending-tool-input",
  });

  await writer.begin_step();
  const tool_input_ready = writer.prepare_tool_input({
    tool_call_id: "call-pending",
    tool_name: "search",
    input: { query: "downcity" },
  });
  await writer.flush();
  assert.deepEqual(recorder.get_message(writer.message_id).parts, []);

  await writer.apply_chunk({ type: "text-start", id: "text-0" });
  await writer.apply_chunk({ type: "text-delta", id: "text-0", delta: "第一段" });
  await writer.apply_chunk({ type: "text-end", id: "text-0" });
  await writer.apply_chunk({ type: "text-start", id: "text-1" });
  await writer.apply_chunk({ type: "text-delta", id: "text-1", delta: "第二段" });
  await writer.apply_chunk({ type: "text-end", id: "text-1" });
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call-pending",
    toolName: "search",
  });
  await tool_input_ready;
  await writer.apply_chunk({
    type: "tool-input-available",
    toolCallId: "call-pending",
    toolName: "search",
    input: { query: "downcity" },
  });
  await writer.apply_chunk({
    type: "tool-output-available",
    toolCallId: "call-pending",
    output: "result",
  });
  await writer.finish_step([
    {
      part_id: "text-final-0",
      sequence: 1,
      type: "text",
      text: "第一段",
      state: "done",
    },
    {
      part_id: "text-final-1",
      sequence: 2,
      type: "text",
      text: "第二段",
      state: "done",
    },
    {
      part_id: "call-pending",
      sequence: 3,
      type: "tool",
      tool_call_id: "call-pending",
      tool_name: "search",
      state: "completed",
      input: { query: "downcity" },
      output: "result",
    },
  ]);
  await writer.complete();

  const assistant = (await read_jsonl(file_path))[0];
  assert.deepEqual(assistant.parts.map((part) => part.type), ["text", "text", "tool"]);
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2, 3]);
  assert.deepEqual(assistant.parts[2].input, { query: "downcity" });
});

test("step abort 与 writer close 会拒绝未释放的 Tool 输入屏障", async () => {
  const { recorder } = await create_recorder("pending-tool-input-cleanup-test");
  const aborted_writer = await recorder.open_assistant_message({
    turn_id: "turn-aborted-tool-input",
  });
  await aborted_writer.begin_step();
  const aborted_input = assert.rejects(
    aborted_writer.prepare_tool_input({
      tool_call_id: "call-aborted",
      tool_name: "search",
      input: { query: "aborted" },
    }),
    /canonical step was aborted: call-aborted/,
  );
  await aborted_writer.flush();
  await aborted_writer.abort_step();
  await aborted_input;
  await aborted_writer.fail("aborted");

  const closed_writer = await recorder.open_assistant_message({
    turn_id: "turn-closed-tool-input",
  });
  const closed_input = assert.rejects(
    closed_writer.prepare_tool_input({
      tool_call_id: "call-closed",
      tool_name: "search",
      input: { query: "closed" },
    }),
    /writer closed with status stopped: call-closed/,
  );
  await closed_writer.flush();
  await closed_writer.stop();
  await closed_input;
});

test("Tool Part 持久化失败时不会释放对应执行等待", async () => {
  const { recorder, store } = await create_recorder(
    "tool-part-persistence-gate-test",
    (options) => new FailingAssistantMessageStore(options),
  );
  const writer = await recorder.open_assistant_message({
    turn_id: "turn-tool-part-persistence",
  });
  await writer.begin_step();
  const tool_input = assert.rejects(
    writer.prepare_tool_input({
      tool_call_id: "call-persistence-failed",
      tool_name: "search",
      input: { query: "downcity" },
    }),
    /canonical step was aborted: call-persistence-failed/,
  );

  store.fail_next_assistant_write("disk full");
  await assert.rejects(
    writer.apply_chunk({
      type: "tool-input-start",
      toolCallId: "call-persistence-failed",
      toolName: "search",
    }),
    /disk full/,
  );
  assert.deepEqual(recorder.get_message(writer.message_id).parts, []);

  await writer.abort_step();
  await tool_input;
  await writer.fail("disk full");
});

test("step 最终快照缺少 canonical Tool chunk 时拒绝猜测顺序", async () => {
  const { recorder, events, file_path } = await create_recorder("final-reconcile-order-test");
  const writer = await recorder.open_assistant_message({ turn_id: "turn-1" });

  await writer.begin_step();
  await writer.apply_chunk({ type: "text-start", id: "text-0" });
  await writer.apply_chunk({ type: "text-delta", id: "text-0", delta: "最终结论" });
  await writer.apply_chunk({ type: "text-end", id: "text-0" });
  const streamed_text_part_id = events.find(
    (event) => event.variant === "part" && event.type === "text",
  ).part.part_id;

  await assert.rejects(
    writer.finish_step([
      {
        part_id: "call-1",
        sequence: 1,
        type: "tool",
        tool_call_id: "call-1",
        tool_name: "shell_exec",
        state: "completed",
        input: { cmd: "pwd" },
        output: { success: true },
      },
      {
        part_id: "text-1",
        sequence: 2,
        type: "text",
        text: "最终结论",
        state: "done",
      },
    ]),
    /snapshot mismatch: part count 1 != 2/,
  );
  await writer.abort_step();
  await writer.fail("canonical snapshot mismatch");

  const assistant = (await read_jsonl(file_path))[0];
  assert.equal(assistant.status, "failed");
  assert.deepEqual(assistant.parts.map((part) => part.type), ["text"]);
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1]);
  assert.equal(assistant.parts[0].part_id, streamed_text_part_id);
});

test("重启时收口 Assistant、取消 Interaction 并标记运行中 Action 失败", async () => {
  const { recorder, files, file_path, assistant_message_file_path } = await create_recorder("recovery-test");
  await recorder.append_user_message({
    turn_id: "turn-1",
    input_type: "prompt",
    parts: [{ part_id: "u1", type: "text", text: "one", state: "done" }],
  });
  const writer = await recorder.open_assistant_message({ turn_id: "turn-1" });
  await writer.apply_chunk({ type: "text-start", id: "text-1" });
  await writer.apply_chunk({ type: "text-delta", id: "text-1", delta: "partial" });
  await writer.apply_chunk({
    type: "tool-input-start",
    toolCallId: "call-recovery",
    toolName: "shell_exec",
  });
  await writer.prepare_tool_input({
    tool_call_id: "call-recovery",
    tool_name: "shell_exec",
    input: { cmd: "pwd" },
  });
  const interactions = new SessionInteractions({
    session_id: "recovery-test",
    messages: recorder,
  });
  await interactions.request({
    interaction_id: "interaction-recovery",
    turn_id: "turn-1",
    kind: "approval",
    source: {
      type: "tool",
      tool_call_id: "call-recovery",
      tool_name: "shell_exec",
    },
    title: "Approve shell_exec",
    command: "pwd",
    cwd: "/workspace",
    reason: "test recovery",
    operation: "exec",
    created_at: Date.now(),
  });
  await recorder.open_action_message({ message_id: "running-action", action_type: "fork", title: "Forking" });

  const recovered_events = [];
  const recovered = new SessionMessages({
    session_id: "recovery-test",
    store: new JsonlSessionMessageStore({ files, session_id: "recovery-test", file_path }),
    publish: (mutation) => recovered_events.push(mutation),
  });
  await recovered.initialize();

  const page = await recovered.list_messages();
  assert.deepEqual(page.items.map((message) => message.type), ["user", "assistant", "action"]);
  assert.equal(page.items[1].status, "stopped");
  assert.equal(page.items[1].parts[0].text, "partial");
  assert.equal(page.items[1].parts.find((part) => part.type === "tool").state, "failed");
  const recovered_interaction = page.items[1].parts.find(
    (part) => part.type === "interaction",
  );
  assert.equal(recovered_interaction.status, "cancelled");
  assert.equal(recovered_interaction.cancel_reason, "runtime_interrupted");
  assert.equal(page.items[2].status, "failed");
  assert.deepEqual(recovered_events.map((event) => `${event.variant}:${event.type}`), [
    "message:assistant",
    "message:action",
  ]);
  assert.equal(await fs.stat(assistant_message_file_path).then(() => true).catch(() => false), false);
});

test("Action revision 追加完整快照，读取时只返回最新版本", async () => {
  const { recorder, file_path } = await create_recorder("action-revision-test");
  const action = await recorder.open_action_message({
    message_id: "action-1",
    action_type: "compact",
    title: "Compacting",
  });
  await action.complete({ title: "Compacted" });
  const history = await read_jsonl(file_path);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((message) => message.revision), [1, 2]);
  const page = await recorder.list_messages();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].title, "Compacted");
});

test("compact 把 Active 前缀关闭为带累计 Summary 的 Segment", async () => {
  const { recorder, file_path } = await create_recorder("compact-test");
  for (let index = 1; index <= 6; index += 1) {
    await recorder.append_user_message({
      turn_id: `turn-${String(index)}`,
      input_type: "prompt",
      parts: [{ part_id: `user-${String(index)}`, type: "text", text: `message ${String(index)}`, state: "done" }],
    });
  }
  const model = new MockLanguageModelV3({
    modelId: "compact-model",
    doGenerate: async () => ({
      content: [{ type: "text", text: "Compact summary" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  assert.equal(await compact_messages(recorder, "compact-test", model), true);
  assert.equal((await fs.readFile(file_path, "utf8")).includes("message 1"), false);
  const active = await recorder.list_messages({ include_internal: true });
  assert.deepEqual(active.items.map((message) => message.sequence), []);
  assert.equal(active.source, "active");
  assert.equal(active.has_more, true);
  const segment = await recorder.list_messages({
    before_sequence: 7,
    include_internal: true,
  });
  assert.deepEqual(segment.items.map((message) => message.sequence), [1, 2, 3, 4, 5, 6]);
  assert.equal(segment.source, "segment");
  assert.equal(
    to_executor_history("compact-test", await recorder.context_snapshot()).length,
    1,
  );
  await assert.rejects(
    recorder.list_messages({ before_sequence: 0 }),
    /before_sequence must be a positive integer/,
  );
});

test("重启后从最新 Segment Summary 与 Active 恢复模型上下文", async () => {
  const session_id = "compact-restart-test";
  const { recorder, files, file_path } = await create_recorder(session_id);
  for (let index = 1; index <= 6; index += 1) {
    await recorder.append_user_message({
      turn_id: `turn-${String(index)}`,
      input_type: "prompt",
      parts: [{
        part_id: `user-${String(index)}`,
        type: "text",
        text: `message ${String(index)}`,
        state: "done",
      }],
    });
  }
  await recorder.compact_active({
    through_sequence: 4,
    summary: {
      record_type: "summary",
      session_id,
      summary_id: "summary-through-4",
      through_sequence: 4,
      text: "summary through 4",
      created_at: 7,
    },
  });

  const restarted = new SessionMessages({
    session_id,
    store: new JsonlSessionMessageStore({ files, session_id, file_path }),
    publish: () => {},
  });
  await restarted.initialize();
  const context = to_executor_history(session_id, await restarted.context_snapshot());
  assert.deepEqual(
    context.map((message) => message.parts[0]?.text),
    ["summary through 4", "message 5", "message 6"],
  );
  const segment = await restarted.list_messages({ before_sequence: 5 });
  assert.deepEqual(segment.items.map((message) => message.sequence), [1, 2, 3, 4]);
});

test("Compact 两步提交中断后会清理 Active 与 Segment 的重叠前缀", async () => {
  const session_id = "compact-overlap-recovery-test";
  const { recorder, files, file_path } = await create_recorder(session_id);
  for (let index = 1; index <= 6; index += 1) {
    await recorder.append_user_message({
      turn_id: `turn-${String(index)}`,
      input_type: "prompt",
      parts: [{
        part_id: `user-${String(index)}`,
        type: "text",
        text: `message ${String(index)}`,
        state: "done",
      }],
    });
  }
  await recorder.compact_active({
    through_sequence: 4,
    summary: {
      record_type: "summary",
      session_id,
      summary_id: "summary-through-4",
      through_sequence: 4,
      text: "summary through 4",
      created_at: 7,
    },
  });

  const segment_path = path.join(
    path.dirname(file_path),
    "segments",
    "000000000001-000000000004.jsonl",
  );
  const segment_rows = await read_jsonl(segment_path);
  const active_rows = await read_jsonl(file_path);
  await fs.writeFile(
    file_path,
    `${[...segment_rows.slice(0, -1), ...active_rows]
      .map((message) => JSON.stringify(message))
      .join("\n")}\n`,
    "utf8",
  );

  const restarted = new SessionMessages({
    session_id,
    store: new JsonlSessionMessageStore({ files, session_id, file_path }),
    publish: () => {},
  });
  await restarted.initialize();
  const active = await restarted.list_messages();
  assert.deepEqual(active.items.map((message) => message.sequence), [5, 6]);
  assert.deepEqual(
    (await read_jsonl(file_path)).map((message) => message.sequence),
    [5, 6],
  );
});

test("连续 Compact 生成按 sequence 连续的 Segment 与累计 Summary", async () => {
  const session_id = "cumulative-compact-test";
  const { recorder } = await create_recorder(session_id);
  const prompts = [];
  let generation_count = 0;
  const model = new MockLanguageModelV3({
    modelId: "cumulative-compact-model",
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      generation_count += 1;
      return {
        content: [{ type: "text", text: `Summary ${String(generation_count)}` }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  const append_messages = async (start, end) => {
    for (let index = start; index <= end; index += 1) {
      await recorder.append_user_message({
        turn_id: `turn-${String(index)}`,
        input_type: "prompt",
        parts: [{
          part_id: `user-${String(index)}`,
          type: "text",
          text: `message ${String(index)}`,
          state: "done",
        }],
      });
    }
  };
  const compact = async () => await compact_messages(recorder, session_id, model);

  await append_messages(1, 8);
  assert.equal(await compact(), true);
  await append_messages(9, 12);
  assert.equal(await compact(), true);

  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].includes("<previous-summary>"), true);
  assert.equal(prompts[1].includes("Summary 1"), true);
  const active = await recorder.list_messages();
  assert.deepEqual(active.items.map((message) => message.sequence), []);
  const latest_segment = await recorder.list_messages({ before_sequence: 13 });
  assert.deepEqual(latest_segment.items.map((message) => message.sequence), [9, 10, 11, 12]);
  assert.equal(latest_segment.has_more, true);
  const earliest_segment = await recorder.list_messages({
    before_sequence: latest_segment.start_sequence,
  });
  assert.deepEqual(earliest_segment.items.map((message) => message.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  const context = to_executor_history(session_id, await recorder.context_snapshot());
  assert.equal(context[0].parts[0]?.text, "Summary 2");
});

test("Summary 生成失败时使用确定性 Summary 完成归档", async () => {
  const session_id = "compact-summary-failure-test";
  const { recorder, file_path } = await create_recorder(session_id);
  for (let index = 1; index <= 6; index += 1) {
    await recorder.append_user_message({
      turn_id: `turn-${String(index)}`,
      input_type: "prompt",
      parts: [{
        part_id: `user-${String(index)}`,
        type: "text",
        text: `message ${String(index)}`,
        state: "done",
      }],
    });
  }
  const model = new MockLanguageModelV3({
    modelId: "failed-compact-model",
    doGenerate: async () => {
      throw new Error("summary unavailable");
    },
  });
  assert.equal(await compact_messages(recorder, session_id, model), true);
  assert.deepEqual((await recorder.list_messages()).items, []);
  const segment_entries = await fs.readdir(path.join(path.dirname(file_path), "segments"));
  assert.equal(segment_entries.length, 1);
});

test("内部上下文读取完整快照并保留第 500 条之后的最新消息", async () => {
  const session_id = "complete-context-snapshot-test";
  const messages = Array.from(
    { length: 501 },
    (_, index) => create_seeded_user_message(session_id, index + 1),
  );
  const { recorder } = await create_seeded_recorder(session_id, messages);
  await recorder.compact_active({
    through_sequence: 499,
    summary: {
      record_type: "summary",
      session_id,
      summary_id: "summary-through-499",
      through_sequence: 499,
      text: "summary through 499",
      created_at: 502,
    },
  });

  const active = await recorder.list_messages();
  assert.deepEqual(active.items.map((message) => message.sequence), [500, 501]);
  assert.equal(active.source, "active");
  assert.equal(active.next_before_sequence, 500);
  const previous = await recorder.list_messages({ before_sequence: 500 });
  assert.equal(previous.source, "segment");
  assert.equal(previous.items.length, 499);
  assert.equal(previous.start_sequence, 1);
  assert.equal(previous.end_sequence, 499);

  const context = to_executor_history(session_id, await recorder.context_snapshot());
  assert.deepEqual(
    context.map((message) => message.parts[0]?.text),
    ["summary through 499", "message 500", "message 501"],
  );
});
