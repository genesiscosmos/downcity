/**
 * @file 验证 Turn 失败收口与最终 Assistant 快照顺序。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionInteractions } from "../../agent/bin/session/control/SessionInteractions.js";
import { SessionApprovalRuntime } from "../../agent/bin/session/execution/tools/SessionApprovalRuntime.js";
import { SqliteSessionStorage } from "../../agent/bin/session/storage/SqliteSessionStorage.js";
import {
  create_workspace_file_mutation_effect,
} from "@downcity/type/workspace";
import { LocalFileSystem } from "@downcity/city";
import { SessionMessages } from "../../agent/bin/session/SessionMessages.js";
import { SessionEventHub } from "../../agent/bin/session/runtime/SessionEventHub.js";
import { SessionLoop } from "../../agent/bin/session/SessionLoop.js";
import { SessionQueue } from "../../agent/bin/session/SessionQueue.js";

async function create_turn_harness(execute_turn, session_origin = { type: "chat" }) {
  const session_id = "session-turn-failure-test";
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-turn-failure-"));
  const files = new LocalFileSystem(root_path);
  const store = new SqliteSessionStorage({
    files,
    session_id,
    agent_id: "test-agent",
    origin: session_origin,
    database_path: path.join(root_path, "session.db"),
    database_location: { type: "file" },
    attachments: {},
  });
  const messages = new SessionMessages({
    session_id,
    store,
    attachment_store: store.attachments,
    publish: () => {},
  });
  await messages.initialize();
  const interactions = new SessionInteractions({ session_id, messages });
  const shell_approval_gateway = new SessionApprovalRuntime({
    session_id,
    interactions,
  });

  const turn = new SessionLoop({
    session_id,
    session_origin,
    workspace_path: root_path,
    executor: {
      execute: async ({ turn_context }) => await execute_turn(turn_context, root_path),
    },
    maintain_context: async () => {},
    state: {
      ensure_runnable: async () => {},
      schedule_title_generation: () => {},
    },
    messages,
    events: new SessionEventHub(),
    logger: { log: async () => {} },
    queue: new SessionQueue(),
    interactions,
    shell_approval_gateway,
  });

  return { messages, root_path, turn };
}

test("Power execution context 保留完整 Session origin", async () => {
  const origin = {
    type: "group",
    group_id: "review-team",
    group_session_id: "group-session-1",
  };
  let execution_context;
  const { turn } = await create_turn_harness(async (turn_context) => {
    execution_context = turn_context.step.hook_context("call-1");
    return {
      success: true,
      text: "done",
    };
  }, origin);

  const handle = await turn.prompt({ query: "hello" });
  await handle.finished;

  assert.equal(execution_context.session_id, "session-turn-failure-test");
  assert.deepEqual(execution_context.session_origin, origin);
  assert.equal(execution_context.call_id, "call-1");
});

/** 通过 Downcity Model Protocol 写入一个完整文本 part。 */
async function write_text(output, content_id, text) {
  await output.write_model_event({ type: "text_start", content_id });
  await output.write_model_event({ type: "text_delta", content_id, delta: text });
  await output.write_model_event({ type: "text_finish", content_id });
}

/** 通过 Downcity Model Protocol 写入一个完整工具调用。 */
async function write_tool_call(output, input) {
  await output.write_model_event({
    type: "tool_call_start",
    content_id: input.content_id,
    tool_call_id: input.tool_call_id,
    tool_name: input.tool_name,
  });
  await output.write_model_event({
    type: "tool_call_finish",
    content_id: input.content_id,
    input: input.tool_input,
  });
}

test("Provider 在输出前失败时只持久化包含 Error Part 的 Agent Message", async () => {
  const { messages, turn } = await create_turn_harness(async () => ({
    success: false,
    text: "",
    error: "quota exceeded",
  }));

  const handle = await turn.prompt({ query: "hello" });
  const result = await handle.finished;
  const page = await messages.list_messages();

  assert.equal(result.success, false);
  assert.equal(result.error, "quota exceeded");
  assert.equal(result.assistant_message, undefined);
  assert.deepEqual(page.items.map((message) => message.role), ["user", "agent"]);
  assert.equal(page.items[1].parts[0].type, "error");
  assert.equal(page.items[1].parts[0].code, "turn_execution_failed");
  assert.equal(page.items[1].parts[0].message, "quota exceeded");
});

test("SessionLoop 只在 canonical 用户消息写入后返回 prompt 句柄", async () => {
  let finish_execution;
  const execution_finished = new Promise((resolve) => {
    finish_execution = resolve;
  });
  const { messages, turn } = await create_turn_harness(async () => {
    await execution_finished;
    return {
      success: true,
      text: "done",
    };
  });

  const handle = await turn.prompt({ query: "已持久化的输入" });
  const page = await messages.list_messages();

  assert.equal(handle.result, null);
  assert.deepEqual(page.items.map((message) => message.role), ["user"]);
  assert.equal(page.items[0].parts[0].text, "已持久化的输入");

  finish_execution();
  await handle.finished;
});

test("SessionLoop 在 Turn 收口后释放其 SessionTurnContext", async () => {
  let release_count = 0;
  const { turn } = await create_turn_harness(async (turn_context) => {
    await turn_context.step.replace_hooks({
      system_blocks: async () => [],
      pipeline: async (_point_name, value) => value,
      effect: async () => {},
      close: async () => {
        release_count += 1;
      },
    });
    return {
      success: true,
      text: "done",
    };
  });

  const handle = await turn.prompt({ query: "hello" });
  await handle.finished;

  assert.equal(release_count, 1);
});

test("SessionLoop 在释放 Power Hook 作用域前触发 turn committed effect", async () => {
  const effects = [];
  let released = false;
  const { turn } = await create_turn_harness(async (turn_context) => {
    await turn_context.step.replace_hooks({
      system_blocks: async () => [],
      pipeline: async (_point_name, value) => value,
      effect: async (point_name, value) => {
        assert.equal(released, false);
        effects.push({ point_name, value });
      },
      close: async () => {
        released = true;
      },
    });
    await turn_context.output.assistant.begin_step();
    await write_text(turn_context.output.assistant, "text-committed", "完成");
    await turn_context.output.assistant.finish_step([{ type: "text", text: "完成" }]);
    return {
      success: true,
      text: "完成",
    };
  });

  const handle = await turn.prompt({ query: "记录这轮" });
  await handle.finished;

  assert.equal(released, true);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].point_name, "session.turn_committed");
  assert.equal(effects[0].value.status, "completed");
  assert.deepEqual(
    effects[0].value.messages.map((message) => message.role),
    ["user", "agent"],
  );
});

test("SessionLoop 只持久化当前 Turn 成功的结构化文件修改", async () => {
  const { messages, turn } = await create_turn_harness(async (turn_context, root_path) => {
    await fs.writeFile(path.join(root_path, "external.ts"), "external\n", "utf8");
    turn_context.effects.append([create_workspace_file_mutation_effect({
      file_path: path.join(root_path, "src/example.ts"),
      before: {
        exists: true,
        sha256: "before",
        content: "const value = 1;\n",
      },
      after: {
        exists: true,
        sha256: "after",
        content: "const value = 2;\nconst next = 3;\n",
      },
    })]);
    return {
      success: true,
      text: "done",
    };
  });

  const handle = await turn.prompt({ query: "修改文件" });
  await handle.finished;
  const page = await messages.list_messages();
  const assistant = page.items.find((message) => message.role === "agent");
  const file_diff = assistant.parts.find((part) => part.type === "data");

  assert.equal(assistant.state, "done");
  assert.equal(file_diff.data_type, "data-session-turn-file-diff");
  assert.equal(file_diff.data.additions, 2);
  assert.equal(file_diff.data.deletions, 1);
  assert.equal(file_diff.data.files[0].file, "src/example.ts");
  assert.match(file_diff.data.files[0].patch, /^diff --git a\/src\/example\.ts b\/src\/example\.ts/m);
  assert.equal(file_diff.data.files.some((file) => file.file === "external.ts"), false);
});

test("Provider 在部分输出后失败时将 Error 追加到同一 Agent Message", async () => {
  const { messages, turn } = await create_turn_harness(async (turn_context) => {
    await turn_context.output.assistant.begin_step();
    await write_text(turn_context.output.assistant, "text-1", "partial response");
    return {
      success: false,
      text: "partial response",
      error: "stream interrupted",
    };
  });

  const handle = await turn.prompt({ query: "hello" });
  const result = await handle.finished;
  const page = await messages.list_messages();

  assert.equal(result.success, false);
  assert.equal(result.assistant_message, undefined);
  assert.deepEqual(page.items.map((message) => message.role), [
    "user",
    "agent",
  ]);
  assert.equal(page.items[1].state, "done");
  assert.equal(page.items[1].parts[0].text, "partial response");
  assert.equal(page.items[1].parts[1].type, "error");
  assert.equal(page.items[1].parts[1].message, "stream interrupted");
});

test("Assistant 失败收口时不会遗留 input-streaming Tool Part", async () => {
  const { messages, turn } = await create_turn_harness(async (turn_context) => {
    await turn_context.output.assistant.begin_step();
    await turn_context.output.assistant.write_model_event({
      type: "tool_call_start",
      content_id: "tool-1",
      tool_call_id: "call-1",
      tool_name: "shell_exec",
    });
    await turn_context.output.assistant.write_model_event({
      type: "tool_call_delta",
      content_id: "tool-1",
      input_delta: '{"cmd":"pwd"}',
    });
    return {
      success: false,
      text: "",
      error: "stream interrupted",
    };
  });

  const handle = await turn.prompt({ query: "hello" });
  await handle.finished;
  const page = await messages.list_messages();
  const assistant = page.items.find((message) => message.role === "agent");

  assert.equal(assistant?.state, "done");
  assert.equal(assistant?.parts[0]?.type, "tool");
  assert.equal(assistant?.parts[0]?.state, "failed");
  assert.equal(assistant?.parts[0]?.error, "stream interrupted");
});

test("Turn 使用标准模型事件保持 Tool 与最终正文顺序", async () => {
  const { messages, turn } = await create_turn_harness(async (turn_context) => {
    await turn_context.output.assistant.begin_step();
    await write_tool_call(turn_context.output.assistant, {
      content_id: "tool-1",
      tool_call_id: "call-1",
      tool_name: "shell_exec",
      tool_input: { cmd: "pwd" },
    });
    await turn_context.output.assistant.write_tool_result({
      tool_call_id: "call-1",
      tool_name: "shell_exec",
      succeeded: true,
      output: { success: true },
    });
    await write_text(turn_context.output.assistant, "text-1", "最终结论");
    const assistant_parts = [
        {
          part_id: "tool:call-1",
          sequence: 1,
          type: "tool",
          tool_call_id: "call-1",
          tool_name: "shell_exec",
          state: "completed",
          input: { cmd: "pwd" },
          output: { success: true },
        },
        { part_id: "text:text-1", sequence: 2, type: "text", text: "最终结论", state: "done" },
      ];
    await turn_context.output.assistant.finish_step(assistant_parts);
    return {
      success: true,
      text: "最终结论",
    };
  });

  const handle = await turn.prompt({ query: "diagnose" });
  const result = await handle.finished;
  const page = await messages.list_messages();
  const assistant = page.items.find((message) => message.role === "agent");

  assert.equal(result.success, true);
  assert.deepEqual(assistant.parts.map((part) => part.type), ["tool", "text"]);
  assert.deepEqual(assistant.parts.map((part) => part.sequence), [1, 2]);
});

test("普通 Tool Loop 的多个 Provider Step 始终写入同一个 Assistant Message", async () => {
  const { messages, turn } = await create_turn_harness(async (turn_context) => {
    await turn_context.output.assistant.begin_step();
    await write_text(turn_context.output.assistant, "text-1", "先检查项目。");
    await write_tool_call(turn_context.output.assistant, {
      content_id: "tool-1",
      tool_call_id: "call-1",
      tool_name: "shell_exec",
      tool_input: { cmd: "pnpm typecheck" },
    });
    await turn_context.output.assistant.write_tool_result({
      tool_call_id: "call-1",
      tool_name: "shell_exec",
      succeeded: true,
      output: { success: true },
    });
    await turn_context.output.assistant.finish_step([
        { part_id: "text:text-1", sequence: 1, type: "text", text: "先检查项目。", state: "done" },
        {
          part_id: "tool:call-1",
          sequence: 2,
          type: "tool",
          tool_call_id: "call-1",
          tool_name: "shell_exec",
          state: "completed",
          input: { cmd: "pnpm typecheck" },
          output: { success: true },
        },
      ]);

    await turn_context.output.assistant.begin_step();
    await write_text(turn_context.output.assistant, "text-2", "检查完成。");
    await turn_context.output.assistant.finish_step([
      { part_id: "text:text-2", sequence: 1, type: "text", text: "检查完成。", state: "done" },
    ]);
    return {
      success: true,
      text: "检查完成。",
    };
  });

  const handle = await turn.prompt({ query: "检查项目" });
  await handle.finished;
  const page = await messages.list_messages();
  const assistant_messages = page.items.filter(
    (message) => message.role === "agent",
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
  const { messages, turn } = await create_turn_harness(async (turn_context) => {
    await turn_context.output.assistant.begin_step();
    await write_text(turn_context.output.assistant, "text-1", "最终结论");
    try {
      await turn_context.output.assistant.finish_step([
          {
            part_id: "tool:call-1",
            sequence: 1,
            type: "tool",
            tool_call_id: "call-1",
            tool_name: "shell_exec",
            state: "completed",
            input: { cmd: "pwd" },
            output: { success: true },
          },
          { part_id: "text:text-1", sequence: 2, type: "text", text: "最终结论", state: "done" },
        ]);
    } catch (error) {
      await turn_context.output.assistant.abort_step();
      return {
        success: false,
        text: "最终结论",
        error: error.message,
      };
    }
  });

  const handle = await turn.prompt({ query: "diagnose" });
  const result = await handle.finished;
  const page = await messages.list_messages();
  const assistant = page.items.find((message) => message.role === "agent");

  assert.equal(result.success, false);
  assert.match(result.error, /snapshot mismatch/);
  assert.equal(assistant.state, "done");
  assert.deepEqual(assistant.parts.map((part) => part.type), ["error"]);
  assert.equal(page.items.at(-1).role, "agent");
  assert.equal(page.items.at(-1).parts[0].type, "error");
});
