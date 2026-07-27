/**
 * @file 验证 Turn 失败收口与最终 Assistant 快照顺序。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionInteractions } from "../bin/session/control/SessionInteractions.js";
import { SessionShellApprovalAdapter } from "../bin/session/execution/tools/SessionShellApprovalAdapter.js";
import { JsonlSessionMessageStore } from "../bin/workspace/store/JsonlSessionMessageStore.js";
import { LocalFileSystem } from "../bin/workspace/LocalFileSystem.js";
import { SessionMessages } from "../bin/session/SessionMessages.js";
import { SessionEventHub } from "../bin/session/runtime/SessionEventHub.js";
import { SessionTurn } from "../bin/session/SessionTurn.js";

async function create_turn_harness(execute_run) {
  const session_id = "session-turn-failure-test";
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-turn-failure-"));
  const messages = new SessionMessages({
    session_id,
    store: new JsonlSessionMessageStore({
      files: new LocalFileSystem(root_path),
      session_id,
      file_path: path.join(root_path, "active.jsonl"),
    }),
    publish: () => {},
  });
  await messages.initialize();
  const interactions = new SessionInteractions({ session_id, messages });
  const shell_approval_gateway = new SessionShellApprovalAdapter({
    session_id,
    interactions,
  });

  const turn = new SessionTurn({
    session_id,
    workspace_path: root_path,
    executor: {
      run: async ({ run_context }) => await execute_run(run_context),
      stop: () => false,
      compact_history: async () => ({ compacted: false, reason: "nothing_to_compact" }),
    },
    state: {
      ensure_runnable: async () => {},
      ensure_title_from_history: async () => {},
      touch_metadata: async () => {},
    },
    messages,
    events: new SessionEventHub(),
    interactions,
    shell_approval_gateway,
    apply_command: async () => {},
  });

  return { messages, turn };
}

test("Provider 在输出前失败时只持久化 Error Message", async () => {
  const { messages, turn } = await create_turn_harness(async () => ({
    success: false,
    text: "",
    error: "quota exceeded",
    deferred_persisted_user_messages: [],
  }));

  const handle = await turn.prompt({ query: "hello" });
  const result = await handle.finished;
  const page = await messages.list_messages();

  assert.equal(result.success, false);
  assert.equal(result.error, "quota exceeded");
  assert.equal(result.assistant_message, undefined);
  assert.deepEqual(page.items.map((message) => message.type), ["user", "error"]);
  assert.equal(page.items[1].code, "turn_execution_failed");
  assert.equal(page.items[1].message, "quota exceeded");
});

test("Provider 在部分输出后失败时保留 failed Assistant 并追加 Error Message", async () => {
  const { messages, turn } = await create_turn_harness(async (run_context) => {
    await run_context.assistant_output.begin_step();
    await run_context.assistant_output.write_chunk({ type: "text-start", id: "text-1" });
    await run_context.assistant_output.write_chunk({
      type: "text-delta",
      id: "text-1",
      delta: "partial response",
    });
    await run_context.assistant_output.write_chunk({ type: "text-end", id: "text-1" });
    return {
      success: false,
      text: "partial response",
      error: "stream interrupted",
      deferred_persisted_user_messages: [],
    };
  });

  const handle = await turn.prompt({ query: "hello" });
  const result = await handle.finished;
  const page = await messages.list_messages();

  assert.equal(result.success, false);
  assert.equal(result.assistant_message, undefined);
  assert.deepEqual(page.items.map((message) => message.type), [
    "user",
    "assistant",
    "error",
  ]);
  assert.equal(page.items[1].status, "failed");
  assert.equal(page.items[1].parts[0].text, "partial response");
  assert.equal(page.items[2].message, "stream interrupted");
});

test("Turn 使用 step canonical chunks 保持 Tool 与最终正文顺序", async () => {
  const { messages, turn } = await create_turn_harness(async (run_context) => {
    await run_context.assistant_output.begin_step();
    await run_context.assistant_output.write_chunk({
      type: "tool-input-start",
      toolCallId: "call-1",
      toolName: "shell_exec",
    });
    await run_context.assistant_output.write_chunk({
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "shell_exec",
      input: { cmd: "pwd" },
    });
    await run_context.assistant_output.write_chunk({
      type: "tool-output-available",
      toolCallId: "call-1",
      output: { success: true },
    });
    await run_context.assistant_output.write_chunk({ type: "text-start", id: "text-1" });
    await run_context.assistant_output.write_chunk({
      type: "text-delta",
      id: "text-1",
      delta: "最终结论",
    });
    await run_context.assistant_output.write_chunk({ type: "text-end", id: "text-1" });
    const assistant_message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "shell_exec",
          state: "output-available",
          input: { cmd: "pwd" },
          output: { success: true },
        },
        { type: "text", text: "最终结论", state: "done" },
      ],
    };
    await run_context.assistant_output.finish_step(assistant_message);
    return {
      success: true,
      text: "最终结论",
      deferred_persisted_user_messages: [],
    };
  });

  const handle = await turn.prompt({ query: "diagnose" });
  const result = await handle.finished;
  const page = await messages.list_messages();
  const assistant = page.items.find((message) => message.type === "assistant");

  assert.equal(result.success, true);
  assert.deepEqual(assistant.parts.map((part) => part.type), ["tool", "text"]);
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2]);
});

test("普通 Tool Loop 的多个 Provider Step 始终写入同一个 Assistant Message", async () => {
  const { messages, turn } = await create_turn_harness(async (run_context) => {
    await run_context.assistant_output.begin_step();
    await run_context.assistant_output.write_chunk({ type: "text-start", id: "text-1" });
    await run_context.assistant_output.write_chunk({
      type: "text-delta",
      id: "text-1",
      delta: "先检查项目。",
    });
    await run_context.assistant_output.write_chunk({ type: "text-end", id: "text-1" });
    await run_context.assistant_output.write_chunk({
      type: "tool-input-start",
      toolCallId: "call-1",
      toolName: "shell_exec",
    });
    await run_context.assistant_output.write_chunk({
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "shell_exec",
      input: { cmd: "pnpm typecheck" },
    });
    await run_context.assistant_output.write_chunk({
      type: "tool-output-available",
      toolCallId: "call-1",
      output: { success: true },
    });
    await run_context.assistant_output.finish_step({
      id: "provider-step-1",
      role: "assistant",
      parts: [
        { type: "text", text: "先检查项目。", state: "done" },
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "shell_exec",
          state: "output-available",
          input: { cmd: "pnpm typecheck" },
          output: { success: true },
        },
      ],
    });

    await run_context.assistant_output.begin_step();
    await run_context.assistant_output.write_chunk({ type: "text-start", id: "text-2" });
    await run_context.assistant_output.write_chunk({
      type: "text-delta",
      id: "text-2",
      delta: "检查完成。",
    });
    await run_context.assistant_output.write_chunk({ type: "text-end", id: "text-2" });
    await run_context.assistant_output.finish_step({
      id: "provider-step-2",
      role: "assistant",
      parts: [{ type: "text", text: "检查完成。", state: "done" }],
    });
    return {
      success: true,
      text: "检查完成。",
      deferred_persisted_user_messages: [],
    };
  });

  const handle = await turn.prompt({ query: "检查项目" });
  await handle.finished;
  const page = await messages.list_messages();
  const assistant_messages = page.items.filter(
    (message) => message.type === "assistant",
  );

  assert.equal(assistant_messages.length, 1);
  assert.deepEqual(
    assistant_messages[0].parts.map((part) => part.type),
    ["text", "tool", "text"],
  );
  assert.deepEqual(
    assistant_messages[0].parts
      .filter((part) => part.type === "text")
      .map((part) => part.text),
    ["先检查项目。", "检查完成。"],
  );
});

test("Turn 在 step 最终快照出现未流式写入的 Tool 时失败", async () => {
  const { messages, turn } = await create_turn_harness(async (run_context) => {
    await run_context.assistant_output.begin_step();
    await run_context.assistant_output.write_chunk({ type: "text-start", id: "text-1" });
    await run_context.assistant_output.write_chunk({
      type: "text-delta",
      id: "text-1",
      delta: "最终结论",
    });
    await run_context.assistant_output.write_chunk({ type: "text-end", id: "text-1" });
    try {
      await run_context.assistant_output.finish_step({
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolCallId: "call-1",
            toolName: "shell_exec",
            state: "output-available",
            input: { cmd: "pwd" },
            output: { success: true },
          },
          { type: "text", text: "最终结论", state: "done" },
        ],
      });
    } catch (error) {
      await run_context.assistant_output.abort_step();
      return {
        success: false,
        text: "最终结论",
        error: error.message,
        deferred_persisted_user_messages: [],
      };
    }
  });

  const handle = await turn.prompt({ query: "diagnose" });
  const result = await handle.finished;
  const page = await messages.list_messages();
  const assistant = page.items.find((message) => message.type === "assistant");

  assert.equal(result.success, false);
  assert.match(result.error, /snapshot mismatch/);
  assert.equal(assistant.status, "failed");
  assert.deepEqual(assistant.parts.map((part) => part.type), ["text"]);
  assert.equal(page.items.at(-1).type, "error");
});
