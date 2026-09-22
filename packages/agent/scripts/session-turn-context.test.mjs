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

test("SessionTurnContext 把 Workspace env 与 Agent systems 固化为只读快照", () => {
  const context = create_session_turn_context({
    session_id: "session-context-test",
    session_origin: { type: "group", group_id: "group-1" },
    turn_id: "turn-context-test",
    project_root: "/workspace",
  });
  // commit 前是初始空值（尚未采集），commit 后是冻结快照。
  assert.equal(context.step.workspace_env, undefined);
  assert.deepEqual(context.step.agent_systems, []);

  context.step.commit({
    workspace_env: { REGION: "cn" },
    agent_systems: ["system"],
  });

  assert.deepEqual(context.step.workspace_env, { REGION: "cn" });
  assert.deepEqual(context.step.agent_systems, ["system"]);
  // 快照必须冻结：Power 拿到的是值，不是可以回写内核的引用。
  assert.equal(Object.isFrozen(context.step.workspace_env), true);
  assert.equal(Object.isFrozen(context.step.agent_systems), true);
});

/**
 * Power hook 不再经 SessionTurnContext 装配。
 *
 * 旧实现里 Step 通过 `step.replace_hooks()` 打开 hook 作用域、通过
 * `step.hook_context()` 取执行上下文。重构后 Power 产物由 City 编译并推送给 Agent，
 * 这两个入口连同作用域类一起被删了（见 063d6cd1e）。
 *
 * 这条断言守的是「别再把它们长回来」：Session 层不再认识 hook 作用域。
 */
test("SessionTurnContext 不再承担 Power hook 装配", () => {
  const context = create_session_turn_context({
    session_id: "session-context-test",
    session_origin: { type: "chat" },
    turn_id: "turn-context-test",
  });
  for (const removed of ["replace_hooks", "hook_context", "release_extensions", "hooks"]) {
    assert.equal(removed in context.step, false, `SessionTurnContext.step 又长回了 ${removed}`);
  }
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
