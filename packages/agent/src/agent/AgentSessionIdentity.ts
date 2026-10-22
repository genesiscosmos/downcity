/**
 * Agent 自己那条会话的存取规则。
 *
 * 职责说明（中文）
 * - Agent 自己就是一条 Session，与其他会话是同一种东西。
 * - 它没有专属字段、专属索引或专属存储：来源是 `{ category: "chat", type: "agent" }`，
 *   分区沿用 `sessions/<category>/<session_id>/`。
 * - 因此这里只有存取所需的两个小函数，不引入新概念。
 *
 * 关键点（中文）
 * - 它的 `session_id` 等于 Agent 的 `id`：会话由它属于谁来标识，不需要人造常量。
 * - 一个 Agent 至多一条，惰性创建；被归档或删除后下一次取用自然重建。
 * - 它的能力由分类决定：属于 `chat`，因此可以协调其他会话。
 */

import { normalize_session_id } from "@/session/SessionIdentity.js";
import {
  SESSION_ORIGIN_CATEGORY_CHAT,
  SESSION_ORIGIN_TYPE_AGENT,
  type SessionOrigin,
} from "@downcity/type";

/** Agent 自己那条会话的来源；不携带额外业务字段。 */
export function create_agent_session_origin(): SessionOrigin {
  return Object.freeze({ category: SESSION_ORIGIN_CATEGORY_CHAT, type: SESSION_ORIGIN_TYPE_AGENT });
}

/** Agent 自己那条会话的稳定标识：就是 Agent 的 id。 */
export function resolve_agent_session_id(agent_id: string): string {
  const resolved = normalize_session_id(agent_id);
  if (!resolved) throw new Error("Agent session requires a non-empty agent id");
  return resolved;
}
