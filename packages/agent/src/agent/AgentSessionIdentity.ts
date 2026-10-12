/**
 * Agent 自己那条会话的存取规则。
 *
 * 职责说明（中文）
 * - Agent 自己就是一条 Session，与 work / task / group 会话是同一种东西。
 * - 它没有专属字段、专属索引或专属存储：角色由 `origin.type = "agent"` 表达，
 *   分区沿用 `sessions/<origin_type>/<session_id>/`，能力与其他会话完全一致。
 * - 因此这里只有存取所需的两个小函数，不引入新概念。
 *
 * 关键点（中文）
 * - 它的 `session_id` 等于 Agent 的 `id`：会话由它属于谁来标识，不需要人造常量。
 * - 一个 Agent 至多一条，惰性创建；被归档或删除后下一次取用自然重建。
 */

import { normalize_session_id } from "@/session/SessionIdentity.js";
import {
  SESSION_ORIGIN_TYPE_AGENT,
  type SessionOrigin,
} from "@downcity/type";

/** Agent 自己那条会话的来源；不携带额外业务字段。 */
export function create_agent_session_origin(): SessionOrigin {
  return Object.freeze({ type: SESSION_ORIGIN_TYPE_AGENT });
}

/** Agent 自己那条会话的稳定标识：就是 Agent 的 id。 */
export function resolve_agent_session_id(agent_id: string): string {
  const resolved = normalize_session_id(agent_id);
  if (!resolved) throw new Error("Agent session requires a non-empty agent id");
  return resolved;
}
