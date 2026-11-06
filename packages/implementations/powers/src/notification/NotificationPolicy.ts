/**
 * 通知来源策略集中适配：普通 Agent 回复只产生会话未读，失败与 Work Main 结果进入 Inbox。
 * 内部 Child、Task、Memory 等交付仍由所属主体负责。Session/Group 以整个会话为关注事项，
 * 业务 Power 以自己的稳定业务对象键为事项；Turn/Run 历史保留在原来源。
 */
import { read_session_delegation_depth } from "@downcity/type";
import type { SessionOrigin, SessionTurnCommittedHookValue } from "@downcity/type";
import type { PowerNotificationInput, PowerNotificationTarget, PowerNotificationTargets, PowerNotificationAvailability } from "@downcity/city/power";
import { notification_target_key } from "./NotificationIdentity.js";

/** Work Main 使用 Session 核心的委派语义；通知 Hook 不自行解释深度或存储分区。 */
function is_work_main(origin: SessionOrigin): boolean {
  return origin.type === "work" && read_session_delegation_depth(origin) === 1;
}

/** 提交事实只决定一次关注事项更新；停止和内部执行不会产生重复交付。 */
export function session_notification(agent_id: string, origin: SessionOrigin | undefined, event: SessionTurnCommittedHookValue): PowerNotificationInput | undefined {
  if (!origin || event.status === "stopped" || !(origin.type === "agent" || is_work_main(origin))) return;
  const failed = event.status === "failed";
  const reply = origin.type === "agent" && !failed;
  const target: PowerNotificationTarget = { kind: "agent_session", agent_id, session_id: event.session_id, category: origin.category, origin_type: origin.type };
  const body = event.result.text.trim() || event.result.error?.trim() || "";
  // 用交付内容的首个非空行命名通知；业务成败由 outcome 单独表达。
  const title = body.split(/\r?\n/).find((line) => line.trim())?.replace(/^\s{0,3}#{1,6}\s+/, "").trim().slice(0, 120);
  return { topic_key: notification_target_key(target), event_id: event.completion_id, target,
    kind: reply ? "reply" : "update", scope: reply ? "session" : "inbox", outcome: failed ? "failure" : "success",
    title: title || (reply ? "会话回复" : "工作结果"),
    body: body.slice(0, 1600) };
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

/** 目录对账只更新可达性；归档、主体移除、目录断连均不会删除摘要或修改阅读状态。 */
export function source_availability(target: PowerNotificationTarget, agent_id: string | undefined, directory: PowerNotificationTargets): PowerNotificationAvailability {
  if (agent_id && !directory.agent_ids.includes(agent_id)) return "removed";
  if (agent_id && directory.unavailable_agents.includes(agent_id)) return "unknown";
  if (target.kind === "power") return "available";
  if (target.kind === "agent_session") {
    if (!directory.agent_ids.includes(target.agent_id)) return "removed";
    if (directory.unavailable_agents.includes(target.agent_id)) return "unknown";
  } else {
    if (!directory.group_ids.includes(target.group_id)) return "removed";
    if (directory.unavailable_groups.includes(target.group_id)) return "unknown";
  }
  const key = notification_target_key(target);
  // 固定自身会话可以在归档后重新创建；当前活动来源优先于同身份归档历史。
  if (!directory.targets.some((candidate) => notification_target_key(candidate) === key)) {
    return directory.archived_targets.some((candidate) => notification_target_key(candidate) === key) ? "archived" : "removed";
  }
  const workspace_id = directory.target_workspaces[key];
  return workspace_id && !directory.workspace_ids.includes(workspace_id) ? "unknown" : "available";
}
