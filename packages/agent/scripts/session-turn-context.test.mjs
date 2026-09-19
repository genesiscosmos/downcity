/**
 * @file 验证 SessionTurnContext 的状态边界与生命周期所有权。
 *
 * 关键点（中文）
 * - 动态输入和输出只能通过领域行为读写。
 * - Step 切换和 Context dispose 都会闭合 Power Hook 作用域。
 * - Power 只获得独立的只读快照，不能访问根上下文能力。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { create_session_turn_context } from "../bin/session/loop/SessionTurnContext.js";

test("SessionTurnContext 在检查点消费输入并封装输出缓冲", async () => {
  let commit_count = 0;
  const internal_messages = [];
  const context = create_session_turn_context({
    session_id: "session-context-test",
    session_origin: { type: "chat" },
    turn_id: "turn-context-test",
    project_root: "/workspace",
    commit_step_input: async () => {
      commit_count += 1;
    },
    append_internal_user_message: async (parts) => {
      internal_messages.push(parts);
      return {
        message_id: "internal-1", session_id: "session-context-test",
        turn_id: "turn-context-test", sequence: 1, revision: 1,
        visibility: "internal", created_at: 1, updated_at: 1,
        role: "user", parts: parts.map((part, index) => ({
          ...part, part_id: `part-${index + 1}`, sequence: index + 1,
        })),
      };
    },
  });
  await context.input.append_internal([{ type: "text", text: "injected" }]);
  context.output.enqueue_assistant_parts([{
    type: "file",
    media_type: "text/plain",
    url: "/workspace/result.txt",
  }]);

  await context.input.checkpoint();
  await context.input.checkpoint();
  assert.equal(internal_messages[0][0].text, "injected");
  assert.equal(commit_count, 2);
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

test("SessionTurnContext 负责 Power Hook 作用域与只读投影生命周期", async () => {
  const released = [];
  const create_scope = (name) => ({
    system_blocks: async () => [],
    pipeline: async (_point_name, value) => value,
    effect: async () => {},
    close: async () => released.push(name),
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
  await context.step.replace_hooks(create_scope("first"));
  await context.step.replace_hooks(create_scope("second"));

  const power_execution_context = context.step.hook_context("call-context-test");
  assert.deepEqual(Object.keys(power_execution_context).sort(), [
    "abort_signal",
    "agent_systems",
    "call_id",
    "project_root",
    "session_id",
    "session_origin",
    "turn_id",
    "workspace_env",
  ]);
  assert.equal(Object.isFrozen(power_execution_context), true);
  assert.equal(power_execution_context.call_id, "call-context-test");
  assert.deepEqual(power_execution_context.session_origin, {
    type: "group",
    group_id: "group-1",
  });
  assert.deepEqual(power_execution_context.workspace_env, { REGION: "cn" });
  assert.deepEqual(released, ["first"]);

  await context.lifecycle.dispose();
  await context.lifecycle.dispose();
  assert.deepEqual(released, ["first", "second"]);
});

test("SessionTurnContext 在整个 Turn 中只解析一次 Power Context", async () => {
  const context = create_session_turn_context({
    session_id: "session-context-test",
    session_origin: { type: "chat" },
    turn_id: "turn-context-test",
  });
  let resolve_count = 0;
  const resolver = async () => {
    resolve_count += 1;
    return [{
      source_power: "memory",
      name: "recall",
      content: "stable recall",
      trust_level: "reference",
      citations: ["memory:1"],
    }];
  };

  const first = await context.step.resolve_power_context_blocks(resolver);
  const second = await context.step.resolve_power_context_blocks(resolver);

  assert.equal(resolve_count, 1);
  assert.equal(first, second);
  assert.equal(first, context.step.power_context_blocks);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first[0]), true);
  assert.equal(Object.isFrozen(first[0].citations), true);
});
