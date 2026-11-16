/** Agent 主会话的固定来源角色；永久身份由存储指针选择，不能从 Agent ID 推导。 */
import {
  SESSION_ORIGIN_CATEGORY_CHAT,
  SESSION_ORIGIN_TYPE_AGENT,
  type SessionOrigin,
} from "@downcity/type";

/** Agent 自己那条会话的来源；不携带额外业务字段。 */
export function create_agent_session_origin(): SessionOrigin {
  return Object.freeze({ category: SESSION_ORIGIN_CATEGORY_CHAT, type: SESSION_ORIGIN_TYPE_AGENT });
}
