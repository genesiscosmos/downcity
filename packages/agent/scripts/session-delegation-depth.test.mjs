/**
 * @file 验证会话派发深度：判据按层数收紧，子会话在创建时记录父深度加一。
 *
 * 关键点（中文）
 * - Chat 根会话缺省深度为 0；无效工作深度拒绝委派，Task 始终禁止委派。
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

test("任务会话不能派发，其余会话按深度限制", () => {
  // 任务会话已经是自动执行链路的一环，无论深度如何都不允许再向外派发。
  assert.equal(can_delegate_work({ category: "work", type: "task" }), false);
  assert.equal(can_delegate_work({ category: "work", type: "task", delegation_depth: 0 }), false);
  assert.match(
    resolve_delegation_blocked_reason({ category: "work", type: "task" }) ?? "",
    /task sessions cannot delegate/i,
  );

  // 普通工作会话必须提供明确深度；缺失深度不能恢复成根会话权限。
  assert.equal(can_delegate_work({ category: "work", type: "work" }), false);
  assert.equal(can_delegate_work({ category: "work", type: "work", delegation_depth: 1 }), true);
  assert.equal(can_delegate_work({ category: "chat", type: "agent" }), true);

  // 原因文案与判据同源：达到上限时两者同时生效。
  const at_limit = { category: "work", type: "work", delegation_depth: SESSION_DELEGATION_MAX_DEPTH };
  assert.equal(can_delegate_work(at_limit), false);
  assert.match(resolve_delegation_blocked_reason(at_limit) ?? "", /depth limit reached/i);
  assert.notEqual(resolve_delegation_blocked_reason({ category: "work", type: "work" }), null);
});

test("派发深度判据按层数收紧，缺失或非法工作深度拒绝派发", () => {
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
