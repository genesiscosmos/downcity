/**
 * @file 验证会话派发深度：判据按层数收紧，子会话在创建时记录父深度加一。
 *
 * 关键点（中文）
 * - 根会话（主会话、外部聊天、任务会话）没有深度字段，按 0 计算。
 * - 达到上限的会话不能再派发；上限值由 `SESSION_DELEGATION_MAX_DEPTH` 单一来源给出。
 * - 深度随会话来源持久化，恢复已有会话时不因调用方变化而改写。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  can_delegate_work,
  read_session_delegation_depth,
  SESSION_DELEGATION_MAX_DEPTH,
} from "@downcity/type";
import { Agent } from "../bin/agent/Agent.js";

test("派发深度判据按层数收紧，且缺失或非法值一律按 0 处理", () => {
  assert.equal(read_session_delegation_depth(undefined), 0);
  assert.equal(read_session_delegation_depth({ category: "chat", type: "agent" }), 0);
  assert.equal(read_session_delegation_depth({ delegation_depth: 2 }), 2);
  // 历史数据或异常值不能阻断派发，回退到根会话深度。
  assert.equal(read_session_delegation_depth({ delegation_depth: -1 }), 0);
  assert.equal(read_session_delegation_depth({ delegation_depth: 1.5 }), 0);
  assert.equal(read_session_delegation_depth({ delegation_depth: "1" }), 0);

  assert.equal(can_delegate_work(undefined), true);
  assert.equal(can_delegate_work({ delegation_depth: SESSION_DELEGATION_MAX_DEPTH - 1 }), true);
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
