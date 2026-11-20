/** Agent 主会话的固定来源角色；永久身份由存储指针选择，不能从 Agent ID 推导。 */
import { SESSION_TYPE_CHAT, SESSION_KIND_MAIN, type SessionDescriptor } from "@downcity/type";

/** Agent 自己那条会话的来源；不携带额外业务字段。 */
export function create_main_session_descriptor(): SessionDescriptor {
  return Object.freeze({ type: SESSION_TYPE_CHAT, kind: SESSION_KIND_MAIN });
}
