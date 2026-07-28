/**
 * @file 验证 SessionTurnContext 的状态边界与生命周期所有权。
 *
 * 关键点（中文）
 * - 动态输入和输出只能通过领域行为读写。
 * - Step 切换和 Context dispose 都会闭合 Plugin lease。
 * - Plugin 只获得独立的只读快照，不能访问根上下文能力。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { create_session_turn_context } from "../bin/session/runtime/SessionTurnContext.js";

test("SessionTurnContext 在检查点消费输入并封装输出缓冲", async () => {
  const context = create_session_turn_context({
    session_id: "session-context-test",
    turn_id: "turn-context-test",
    project_root: "/workspace",
    merge_step_input: async () => [{
      id: "queued-message",
      role: "user",
      metadata: {
        v: 1,
        ts: 2,
        session_id: "session-context-test",
        source: "ingress",
        kind: "normal",
      },
      parts: [{ type: "text", text: "queued" }],
    }],
  });
  context.input.inject_user_message({
    id: "injected-message",
    role: "user",
    metadata: {
      v: 1,
      ts: 1,
      session_id: "session-context-test",
      source: "ingress",
      kind: "normal",
    },
    parts: [{ type: "text", text: "injected" }],
  });
  context.output.enqueue_assistant_parts([{
    type: "file",
    mediaType: "text/plain",
    url: "/workspace/result.txt",
  }]);

  assert.deepEqual(
    (await context.input.checkpoint()).map((message) => message.id),
    ["injected-message", "queued-message"],
  );
  assert.deepEqual(
    (await context.input.checkpoint()).map((message) => message.id),
    ["queued-message"],
  );
  assert.equal(context.output.take_assistant_parts().length, 1);
  assert.equal(context.output.take_assistant_parts().length, 0);
});

test("SessionTurnContext 负责 Plugin lease 与只读投影生命周期", async () => {
  const released = [];
  const create_lease = (name) => ({
    read: () => ({ plugins: [] }),
    run_action: async () => ({ success: true }),
    system_blocks: async () => [],
    release: async () => released.push(name),
  });
  const context = create_session_turn_context({
    session_id: "session-context-test",
    turn_id: "turn-context-test",
    project_root: "/workspace",
  });
  context.step.commit({
    workspace_env: { REGION: "cn" },
    agent_systems: ["system"],
  });
  await context.step.replace_plugins(create_lease("first"));
  await context.step.replace_plugins(create_lease("second"));

  const plugin_execution_context = context.step.plugin_execution_context();
  assert.deepEqual(Object.keys(plugin_execution_context).sort(), [
    "abort_signal",
    "agent_systems",
    "project_root",
    "session_id",
    "turn_id",
    "workspace_env",
  ]);
  assert.equal(Object.isFrozen(plugin_execution_context), true);
  assert.deepEqual(plugin_execution_context.workspace_env, { REGION: "cn" });
  assert.deepEqual(released, ["first"]);

  await context.lifecycle.dispose();
  await context.lifecycle.dispose();
  assert.deepEqual(released, ["first", "second"]);
});
