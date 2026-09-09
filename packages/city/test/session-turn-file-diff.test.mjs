/**
 * @file 验证 Session Turn Diff 只由 Workspace 结构化文件修改事实构建。
 *
 * 关键点（中文）
 * - 同一 Turn 内连续的 write/edit 会聚合为一个最终 Diff。
 * - 不同 Session 的修改事实互不共享。
 * - 外部写入打断状态链时，不会把无法证明归属的变化计入当前 Turn。
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Agent } from "../../agent/bin/index.js";
import {
  build_session_turn_file_diff,
} from "../../agent/bin/session/messages/SessionTurnFileDiffBuilder.js";
import { Workspace } from "@downcity/city";
import { create_workspace_file_mutation_effect } from "@downcity/type/workspace";

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

/** 由完整 Downcity Model 事件构造一次测试响应。 */
function event_stream(events) {
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });
}

/** 为测试文本生成与 Workspace 一致的 SHA-256。 */
function text_sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** 构造一个已存在文本文件的修改状态。 */
function text_state(content) {
  return {
    exists: true,
    sha256: text_sha256(content),
    content,
  };
}

/** 使用 Workspace 公开协议把文件修改事实投影为 Tool effect。 */
function build_file_diff(workspace_path, mutations) {
  return build_session_turn_file_diff(
    workspace_path,
    mutations.map(create_workspace_file_mutation_effect),
  );
}

test("同一 Turn 的连续 write/edit 聚合为文件最终 Diff", () => {
  const workspace_path = path.resolve("/workspace/session-a");
  const initial_content = "first\n";
  const final_content = "second\nthird\n";
  const file_diff = build_file_diff(workspace_path, [
    {
      file_path: path.join(workspace_path, "src/example.ts"),
      before: { exists: false },
      after: text_state(initial_content),
    },
    {
      file_path: path.join(workspace_path, "src/example.ts"),
      before: text_state(initial_content),
      after: text_state(final_content),
    },
  ]);

  assert.equal(file_diff.files.length, 1);
  assert.equal(file_diff.files[0].file, "src/example.ts");
  assert.equal(file_diff.files[0].status, "added");
  assert.equal(file_diff.additions, 2);
  assert.equal(file_diff.deletions, 0);
  assert.match(file_diff.files[0].patch, /\+second/);
  assert.match(file_diff.files[0].patch, /\+third/);
  assert.doesNotMatch(file_diff.files[0].patch, /\+first/);
});

test("两个 Session 只消费各自 TurnContext 持有的修改事实", () => {
  const workspace_path = path.resolve("/workspace/shared");
  const session_a_diff = build_file_diff(workspace_path, [{
    file_path: path.join(workspace_path, "session-a.txt"),
    before: { exists: false },
    after: text_state("from a\n"),
  }]);
  const session_b_diff = build_file_diff(workspace_path, [{
    file_path: path.join(workspace_path, "session-b.txt"),
    before: { exists: false },
    after: text_state("from b\n"),
  }]);

  assert.deepEqual(session_a_diff.files.map((file) => file.file), ["session-a.txt"]);
  assert.deepEqual(session_b_diff.files.map((file) => file.file), ["session-b.txt"]);
});

test("Shell 或外部写入没有结构化修改事实时不产生 Diff", () => {
  const workspace_path = path.resolve("/workspace/external");
  assert.equal(build_file_diff(workspace_path, []), undefined);
});

test("非 Workspace 文件修改的 Turn effect 不产生 Diff", () => {
  const workspace_path = path.resolve("/workspace/other-effect");
  assert.equal(build_session_turn_file_diff(workspace_path, [{
    type: "example.completed",
    data: { value: true },
  }]), undefined);
});

test("外部写入打断同一文件的状态链时忽略该文件", () => {
  const workspace_path = path.resolve("/workspace/conflict");
  const file_path = path.join(workspace_path, "shared.txt");
  const file_diff = build_file_diff(workspace_path, [
    {
      file_path,
      before: text_state("base\n"),
      after: text_state("agent first\n"),
    },
    {
      file_path,
      before: text_state("external change\n"),
      after: text_state("agent second\n"),
    },
  ]);

  assert.equal(file_diff, undefined);
});

test("Workspace 范围外的修改事实不会进入当前 Session Diff", () => {
  const workspace_path = path.resolve("/workspace/current");
  const file_diff = build_file_diff(workspace_path, [{
    file_path: path.resolve("/workspace/other/outside.txt"),
    before: { exists: false },
    after: text_state("outside\n"),
  }]);

  assert.equal(file_diff, undefined);
});

test("相对路径修改事实不会按进程 cwd 猜测归属", () => {
  const file_diff = build_file_diff(process.cwd(), [{
    file_path: "relative.txt",
    before: { exists: false },
    after: text_state("relative\n"),
  }]);

  assert.equal(file_diff, undefined);
});

test("并行 Session 的真实 Workspace write 只进入各自 Assistant Diff", async (context) => {
  const workspace_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-turn-diff-"));
  context.after(async () => await fs.rm(workspace_path, { recursive: true, force: true }));
  const model = {
    id: "turn-diff-model",
    async stream(call) {
      if (!call.tools?.length) return title_stream(this.id);
      const serialized_messages = JSON.stringify(call.messages);
      const session_name = serialized_messages.includes("session-b") ? "session-b" : "session-a";
      const has_tool_result = call.messages.some((message) => message.role === "tool");
      if (!has_tool_result) return write_tool_stream(this.id, session_name);
      await fs.writeFile(
        path.join(workspace_path, `${session_name}-external.txt`),
        "external\n",
        "utf8",
      );
      return final_text_stream(this.id, session_name);
    },
  };
  const agent = new Agent({ id: "turn_diff_agent", model });
  context.after(async () => await agent.dispose());
  const workspace = new Workspace({
    id: "workspace",
    path: workspace_path,
  });
  const [session_a, session_b] = await Promise.all([
    agent.sessions.create({ workspace }),
    agent.sessions.create({ workspace }),
  ]);

  await Promise.all([
    session_a.prompt({ query: "write session-a" }).then((handle) => handle.finished),
    session_b.prompt({ query: "write session-b" }).then((handle) => handle.finished),
  ]);

  const [messages_a, messages_b] = await Promise.all([
    session_a.messages(),
    session_b.messages(),
  ]);
  assert.deepEqual(read_diff_files(messages_a), ["session-a.txt"]);
  assert.deepEqual(read_diff_files(messages_b), ["session-b.txt"]);
});

/** 返回不带 Tool 的标题生成响应。 */
function title_stream(model_id) {
  return event_stream([
    { type: "model_start", request_id: "title", model_id },
    { type: "text_start", content_id: "title-text" },
    { type: "text_delta", content_id: "title-text", delta: "Diff test" },
    { type: "text_finish", content_id: "title-text" },
    { type: "model_usage", usage },
    { type: "model_finish", finish_reason: "stop" },
  ]);
}

/** 返回一次 Workspace write Tool 调用。 */
function write_tool_stream(model_id, session_name) {
  return event_stream([
    { type: "model_start", request_id: `${session_name}-write`, model_id },
    {
      type: "tool_call_start",
      content_id: `${session_name}-tool`,
      tool_call_id: `${session_name}-call`,
      tool_name: "write",
    },
    {
      type: "tool_call_finish",
      content_id: `${session_name}-tool`,
      input: {
        file_path: `${session_name}.txt`,
        content: `${session_name}\n`,
      },
    },
    { type: "model_usage", usage },
    { type: "model_finish", finish_reason: "tool_call" },
  ]);
}

/** 返回 Tool Loop 的最终文本响应。 */
function final_text_stream(model_id, session_name) {
  return event_stream([
    { type: "model_start", request_id: `${session_name}-done`, model_id },
    { type: "text_start", content_id: `${session_name}-text` },
    { type: "text_delta", content_id: `${session_name}-text`, delta: "done" },
    { type: "text_finish", content_id: `${session_name}-text` },
    { type: "model_usage", usage },
    { type: "model_finish", finish_reason: "stop" },
  ]);
}

/** 从 Session 历史中读取 Turn Diff 的文件路径。 */
function read_diff_files(messages) {
  const assistant = messages.items.find((message) => message.role === "agent");
  const file_diff = assistant?.parts.find((part) =>
    part.type === "data" && part.data_type === "data-session-turn-file-diff"
  );
  assert.ok(file_diff, "Assistant Message 应包含结构化文件编辑 Diff");
  return file_diff.data.files.map((file) => file.file);
}
