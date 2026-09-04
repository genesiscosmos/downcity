/**
 * @file 验证 SessionTurnContext 的状态边界与生命周期所有权。
 *
 * 关键点（中文）
 * - 动态输入和输出只能通过领域行为读写。
 * - Step 切换和 Context dispose 都会闭合 Extension lease。
 * - Plugin 只获得独立的只读快照，不能访问根上下文能力。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { create_session_turn_context } from "../bin/session/runtime/SessionTurnContext.js";

function create_user_message(message_id, text, created_at) {
  return {
    message_id,
    session_id: "session-context-test",
    turn_id: "turn-context-test",
    sequence: created_at,
    revision: 1,
    visibility: "visible",
    created_at,
    updated_at: created_at,
    type: "user",
    input_type: "steer",
    parts: [{
      part_id: `${message_id}:text`,
      type: "text",
      text,
      state: "done",
    }],
  };
}

test("SessionTurnContext 在检查点消费输入并封装输出缓冲", async () => {
  const context = create_session_turn_context({
    session_id: "session-context-test",
    session_origin: { type: "chat" },
    turn_id: "turn-context-test",
    project_root: "/workspace",
    merge_step_input: async () => [create_user_message("queued-message", "queued", 2)],
  });
  context.input.inject_user_message(
    create_user_message("injected-message", "injected", 1),
  );
  context.output.enqueue_assistant_parts([{
    type: "file",
    media_type: "text/plain",
    url: "/workspace/result.txt",
  }]);

  assert.deepEqual(
    (await context.input.checkpoint()).map((message) => message.message_id),
    ["injected-message", "queued-message"],
  );
  assert.deepEqual(
    (await context.input.checkpoint()).map((message) => message.message_id),
    ["queued-message"],
  );
  assert.equal(context.output.take_assistant_parts().length, 1);
  assert.equal(context.output.take_assistant_parts().length, 0);
});

test("SessionTurnContext 只按顺序收集当前 Turn 的 Tool effects", () => {
  const context = create_session_turn_context({
    session_id: "session-context-test",
    session_origin: { type: "chat" },
    turn_id: "turn-context-test",
  });
  context.effects.append([{
    type: "example.first",
    data: { value: 1 },
  }]);
  const first_snapshot = context.effects.snapshot();
  context.effects.append([{
    type: "example.second",
    data: { value: 2 },
  }]);

  assert.equal(Object.isFrozen(first_snapshot), true);
  assert.deepEqual(first_snapshot.map((effect) => effect.type), ["example.first"]);
  assert.deepEqual(
    context.effects.snapshot().map((effect) => effect.type),
    ["example.first", "example.second"],
  );
});

test("SessionTurnContext 负责 Extension lease 与只读投影生命周期", async () => {
  const released = [];
  const create_lease = (name) => ({
    read: () => ({ plugins: [] }),
    run_action: async () => ({ success: true }),
    system_blocks: async () => [],
    pipeline: async (_point_name, value) => value,
    effect: async () => {},
    release: async () => released.push(name),
  });
  const context = create_session_turn_context({
    session_id: "session-context-test",
    session_origin: { type: "group", group_id: "group-1" },
    turn_id: "turn-context-test",
    project_root: "/workspace",
  });
  context.step.commit({
    workspace_env: { REGION: "cn" },
    agent_systems: ["system"],
  });
  await context.step.replace_extensions(create_lease("first"));
  await context.step.replace_extensions(create_lease("second"));

  const plugin_execution_context = context.step.extension_execution_context("call-context-test");
  assert.deepEqual(Object.keys(plugin_execution_context).sort(), [
    "abort_signal",
    "agent_systems",
    "call_id",
    "project_root",
    "session_id",
    "session_origin",
    "turn_id",
    "workspace_env",
  ]);
  assert.equal(Object.isFrozen(plugin_execution_context), true);
  assert.equal(plugin_execution_context.call_id, "call-context-test");
  assert.deepEqual(plugin_execution_context.session_origin, {
    type: "group",
    group_id: "group-1",
  });
  assert.deepEqual(plugin_execution_context.workspace_env, { REGION: "cn" });
  assert.deepEqual(released, ["first"]);

  await context.lifecycle.dispose();
  await context.lifecycle.dispose();
  assert.deepEqual(released, ["first", "second"]);
});

test("SessionTurnContext 在整个 Turn 中只解析一次 Extension Context", async () => {
  const context = create_session_turn_context({
    session_id: "session-context-test",
    session_origin: { type: "chat" },
    turn_id: "turn-context-test",
  });
  let resolve_count = 0;
  const resolver = async () => {
    resolve_count += 1;
    return [{
      source_extension: "memory",
      name: "recall",
      content: "stable recall",
      trust_level: "reference",
      citations: ["memory:1"],
    }];
  };

  const first = await context.step.resolve_extension_context_blocks(resolver);
  const second = await context.step.resolve_extension_context_blocks(resolver);

  assert.equal(resolve_count, 1);
  assert.equal(first, second);
  assert.equal(first, context.step.extension_context_blocks);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first[0]), true);
  assert.equal(Object.isFrozen(first[0].citations), true);
});
