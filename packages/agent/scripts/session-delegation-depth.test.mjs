/**
 * @file 验证会话派发深度：判据按层数收紧，子会话在创建时记录父深度加一。
 *
 * 关键点（中文）
 * - Chat 深度为 0，任意来源 Main 为 1，Child 为 2；来源不决定分工能力。
 * - 达到上限的会话不能再派发；上限值由 `SESSION_DELEGATION_MAX_DEPTH` 单一来源给出。
 * - 深度随会话来源持久化，恢复已有会话时不因调用方变化而改写。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  can_delegate_work,
  read_session_delegation_depth,
  resolve_delegation_blocked_reason,
  SESSION_DELEGATION_MAX_DEPTH,
} from "@downcity/type";
import { Agent } from "../bin/agent/Agent.js";
import { create_work_origin, require_direct_work_child, require_work_creator } from "../bin/agent/SessionWorkPolicy.js";
import { SessionChildWorkLifecycle } from "../bin/session/loop/SessionChildWorkLifecycle.js";

test("任意来源的Main可分工，Child与受限评审器不可继续派发", () => {
  assert.equal(can_delegate_work({ category: "work", type: "task" }), true);
  assert.equal(can_delegate_work({ category: "work", type: "task", delegation_depth: 0 }), false);
  assert.equal(can_delegate_work({ category: "work", type: "task", delegation_depth: 1 }), true);
  assert.equal(can_delegate_work({ category: "work", type: "task", role: "user_simulator", delegation_depth: 2 }), false);
  assert.equal(can_delegate_work({ category: "work", type: "custom_source" }), true);
  assert.equal(can_delegate_work({ category: "chat", type: "custom_channel" }), true);
  for (const type of ["work", "task", "custom_source"]) {
    const main = { category: "work", type, delegation_depth: 1 };
    assert.equal(can_delegate_work(main), true, type);
    assert.equal(resolve_delegation_blocked_reason(main), null, type);
    const child = { ...main, delegation_depth: SESSION_DELEGATION_MAX_DEPTH };
    assert.equal(can_delegate_work(child), false, type);
    assert.match(resolve_delegation_blocked_reason(child) ?? "", /depth limit reached/i);
  }

  // 用户直接创建的普通 Work 无父关系，可在深度上限内创建多个 Subwork。
  assert.equal(can_delegate_work({ category: "work", type: "work" }), true);
  assert.equal(read_session_delegation_depth({ category: "work", type: "work" }), 1);
  assert.equal(can_delegate_work({ category: "work", type: "work", delegation_depth: 1 }), true);
  assert.equal(can_delegate_work({ category: "chat", type: "agent" }), true);

  // 原因文案与判据同源：达到上限时两者同时生效。
  const at_limit = { category: "work", type: "work", delegation_depth: SESSION_DELEGATION_MAX_DEPTH };
  assert.equal(can_delegate_work(at_limit), false);
  assert.match(resolve_delegation_blocked_reason(at_limit) ?? "", /depth limit reached/i);
  assert.equal(resolve_delegation_blocked_reason({ category: "work", type: "work" }), null);
});

test("用户 Work 按工作层级解析，非法或不完整的委派来源拒绝派发", () => {
  assert.equal(read_session_delegation_depth(undefined), Infinity);
  assert.equal(read_session_delegation_depth({ category: "chat", type: "agent" }), 0);
  assert.equal(read_session_delegation_depth({ delegation_depth: 2 }), 2);
  // 无效数据不能放宽成 Chat 根会话权限。
  assert.equal(read_session_delegation_depth({ delegation_depth: -1 }), Infinity);
  assert.equal(read_session_delegation_depth({ delegation_depth: 1.5 }), Infinity);
  assert.equal(read_session_delegation_depth({ delegation_depth: "1" }), Infinity);

  assert.equal(can_delegate_work(undefined), false);
  assert.equal(can_delegate_work({ category: "work", type: "work", delegation_depth: SESSION_DELEGATION_MAX_DEPTH - 1 }), true);
  assert.equal(can_delegate_work({ delegation_depth: SESSION_DELEGATION_MAX_DEPTH }), false);
  assert.equal(can_delegate_work({ delegation_depth: SESSION_DELEGATION_MAX_DEPTH + 1 }), false);
});

test("工作子会话在创建时写入父深度加一，恢复时保留自身深度", async () => {
  const agent = new Agent({ id: "depth-agent" });
  const workspace = create_minimal_workspace();

  const root = await agent.sessions.ensure_work_session("depth-root", workspace, 1);
  assert.equal(root.origin.category, "work");
  assert.equal(root.origin.type, "work");
  assert.equal(read_session_delegation_depth(root.origin), 1);

  // 同一标识再次取用应复用已存在的会话，深度不被本次传参覆盖。
  const reused = await agent.sessions.ensure_work_session("depth-root", workspace, 2);
  assert.equal(reused.id, root.id);
  assert.equal(read_session_delegation_depth(reused.origin), 1);

  await agent.dispose();
});

test("Task Main 无需 Chat 父会话即可创建并控制任意来源的直接 Child", () => {
  const caller = {
    agent_id: "task-agent",
    session_id: "task-main",
    origin: { category: "work", type: "task", delegation_depth: 1 },
    turn_id: "task-turn",
    tool_call_id: "spawn-child",
  };
  assert.doesNotThrow(() => require_work_creator(caller));
  const child_origin = create_work_origin(caller);
  assert.equal(read_session_delegation_depth(child_origin), 2);
  assert.equal(child_origin.parent_agent_id, caller.agent_id);
  assert.equal(child_origin.parent_session_id, caller.session_id);
  assert.equal(child_origin.parent_session_category, "work");
  assert.equal(can_delegate_work(child_origin), false);

  const target = {
    id: "task-child",
    agent_id: caller.agent_id,
    origin: { ...child_origin, type: "custom_child_source" },
  };
  assert.doesNotThrow(() => require_direct_work_child(caller.agent_id, caller, target));
  assert.throws(() => require_direct_work_child(caller.agent_id, caller, {
    ...target, origin: { ...target.origin, parent_session_id: "another-main" },
  }), /session_target_forbidden/);
  assert.throws(() => require_work_creator({
    ...caller, origin: { ...caller.origin, parent_session_id: "incomplete-parent" },
  }), /session_relation_invalid/);
});

test("停止或失败 Chat 不取消后台 Main，已中止的 Main 仍幂等清理 Child", async () => {
  const cancellations = [];
  const lifecycle = new SessionChildWorkLifecycle({
    wait: async () => {},
    cancel: async (input) => { cancellations.push(input); },
  }, { log: async () => {} });
  const chat_controller = new AbortController();
  const chat_context = {
    session: { session_id: "chat", turn_id: "chat-turn", origin: { category: "chat", type: "agent" } },
    lifecycle: { abort_signal: chat_controller.signal },
  };
  // Chat 的失败收尾与显式停止共用 cancel；两种路径都不能撤销自主 Main。
  await lifecycle.cancel(chat_context);
  chat_controller.abort(new Error("Chat reply stopped"));
  await lifecycle.cancel(chat_context);
  assert.deepEqual(cancellations, []);

  const main_controller = new AbortController();
  const main_context = {
    session: { session_id: "main", turn_id: "main-turn", origin: { category: "work", type: "task", delegation_depth: 1 } },
    lifecycle: { abort_signal: main_controller.signal },
  };
  main_controller.abort(new Error("Main stopped"));
  await Promise.all([lifecycle.cancel(main_context), lifecycle.cancel(main_context)]);
  assert.equal(cancellations.length, 1);
  assert.equal(cancellations[0].session_id, "main");
  assert.equal(cancellations[0].turn_id, "main-turn");
  assert.equal(cancellations[0].abort_signal.aborted, true);
});

test("Task Main 等待 Child，Chat 和 Child 不进入子工作等待", async () => {
  const waits = [];
  let complete_child;
  let observe_wait;
  const child_completed = new Promise((resolve) => { complete_child = resolve; });
  const wait_observed = new Promise((resolve) => { observe_wait = resolve; });
  const lifecycle = new SessionChildWorkLifecycle({
    wait: async (input) => {
      waits.push(input);
      observe_wait();
      await child_completed;
    },
    cancel: async () => {},
  }, { log: async () => {} });
  const controller = new AbortController();
  const context = {
    session: { session_id: "task-main", turn_id: "task-turn", origin: { category: "work", type: "task", delegation_depth: 1 } },
    lifecycle: { abort_signal: controller.signal },
  };
  let finished = false;
  const waiting = lifecycle.wait(context, () => false).then((pending) => { finished = true; return pending; });
  await wait_observed;
  assert.equal(finished, false);
  assert.equal(waits.length, 1);
  assert.equal(waits[0].session_id, "task-main");
  complete_child();
  assert.equal(await waiting, false);
  assert.equal(waits[0].abort_signal.aborted, true);

  for (const origin of [
    { category: "chat", type: "agent" },
    { category: "work", type: "task", delegation_depth: 2 },
  ]) {
    assert.equal(await lifecycle.wait({ ...context, session: { ...context.session, origin } }, () => false), false);
  }
  assert.equal(waits.length, 1);
});

/** 构造只满足会话创建所需依赖的最小 Workspace。 */
function create_minimal_workspace() {
  return {
    id: "depth-workspace",
    path: process.cwd(),
    tools: {},
    get_env: () => ({}),
    dispose: async () => {},
  };
}
