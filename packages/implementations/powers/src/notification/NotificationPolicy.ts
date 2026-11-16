/**
 * 通知来源策略集中适配：普通 Agent 回复只产生会话未读，失败与 Work Main 结果进入 Inbox。
 * 内部 Child、Task、Memory 等交付仍由所属主体负责。Session/Group 以整个会话为关注事项，
 * 业务 Power 以自己的稳定业务对象键为事项；Turn/Run 历史保留在原来源。
 */
import { read_session_delegation_depth } from "@downcity/type";
import type { SessionOrigin, SessionTurnCommittedHookValue } from "@downcity/type";
import type { PowerNotificationInput, PowerNotificationTarget, PowerNotificationResolution } from "@downcity/city/power";
import { notification_target_key } from "./NotificationIdentity.js";

/** Work Main 使用 Session 核心的委派语义；通知 Hook 不自行解释深度或存储分区。 */
function is_work_main(origin: SessionOrigin): boolean {
  return origin.type === "work" && read_session_delegation_depth(origin) === 1;
}

/** 提交事实只决定一次关注事项更新；停止和内部执行不会产生重复交付。 */
export function session_notification(agent_id: string, origin: SessionOrigin | undefined, event: SessionTurnCommittedHookValue, session_title?: string): PowerNotificationInput | undefined {
  if (!origin || event.status === "stopped" || !(origin.type === "agent" || is_work_main(origin))) return;
  const failed = event.status === "failed";
  const reply = origin.type === "agent" && !failed;
  const target: PowerNotificationTarget = { kind: "agent_session", agent_id, session_id: event.session_id, category: origin.category, origin_type: origin.type };
  const body = event.result.text.trim() || event.result.error?.trim() || "";
  // 通知围绕来源会话命名；交付内容只作为正文，不承担标题语义。
  const title = session_title?.trim() || "未命名会话";
  return { topic_key: notification_target_key(target), event_id: event.completion_id, target,
    kind: reply ? "reply" : "update", scope: reply ? "session" : "inbox", outcome: failed ? "failure" : "success",
    title,
    body: body.slice(0, 1600) };
}

/** 来源真实标题只作展示；读取失败时保留通知发布时的摘要。 */
export function notification_session_title(source?: PowerNotificationResolution): string | undefined {
  if (!source || source.target.kind === "power" || source.title === undefined) return;
  return source.title.trim() || "未命名会话";
}

/** 原 Interaction 的准确来源直接决定导航，不从 chat/work 分区猜业务角色。 */
export function interaction_target(agent_id: string, session_id: string, origin?: SessionOrigin): PowerNotificationTarget | undefined {
  if (!origin) return;
  if (origin.type === "group") {
    if (typeof origin.group_id !== "string" || typeof origin.group_session_id !== "string") return;
    return { kind: "group_session", group_id: origin.group_id, session_id: origin.group_session_id };
  }
  return { kind: "agent_session", agent_id, category: origin.category, session_id, origin_type: origin.type };
}
