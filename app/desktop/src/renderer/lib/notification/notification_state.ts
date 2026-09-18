/** Desktop Notification 在 Renderer 中的只读查询与导航目标投影。 */

import type {
  DesktopAgentSessionNotificationTarget,
  DesktopGroupSessionNotificationTarget,
  DesktopNotification,
  DesktopNotificationState,
  DesktopNotificationTarget,
} from "../../../common/types/DesktopNotification";
import type { PowerJsonObject } from "@downcity/city/power";
import type { PowerRendererNotification } from "@downcity/city/power/react";
import type { NavigationTarget } from "../../types/DesktopView";
import { attention_from_notification_kind, highest_attention, type ChatAttention } from "./attention.ts";

/** 创建 Agent Session 的稳定通知目标。 */
export function create_agent_session_notification_target(
  workspace_id: string,
  agent_id: string,
  session_id: string,
): DesktopAgentSessionNotificationTarget {
  return { kind: "agent_session", workspace_id, agent_id, session_id };
}

/** 创建 GroupSession 的稳定通知目标。 */
export function create_group_session_notification_target(
  group_id: string,
  session_id: string,
): DesktopGroupSessionNotificationTarget {
  return { kind: "group_session", group_id, session_id };
}

/** 将当前页面导航投影为可被 Notification 识别的目标。 */
export function notification_target_from_navigation(
  target: NavigationTarget | null,
  power_routes: Readonly<Record<string, PowerJsonObject>> = {},
): DesktopNotificationTarget | undefined {
  if (target?.kind === "session") {
    return create_agent_session_notification_target(target.workspace_id, target.agent_id, target.session_id);
  }
  if (target?.kind === "group_session") {
    return create_group_session_notification_target(target.group_id, target.session_id);
  }
  if (target?.kind === "power_workspace" || target?.kind === "power") {
    return {
      kind: "power",
      power_id: target.power_id,
      route: target.kind === "power_workspace" ? structuredClone(power_routes[target.power_id] ?? {}) : {},
    };
  }
  return undefined;
}

/** 读取一条 Session 的未读注意力等级；无未读时返回 null。 */
export function get_session_unread_attention(
  state: DesktopNotificationState,
  workspace_id: string,
  agent_id: string,
  session_id: string,
): ChatAttention | null {
  return highest_session_attention(state, (target) => target.kind === "agent_session"
    && target.workspace_id === workspace_id
    && target.agent_id === agent_id
    && target.session_id === session_id);
}

/** 读取一个 Agent 任意 Session 的未读注意力等级；无未读时返回 null。 */
export function get_agent_unread_attention(state: DesktopNotificationState, agent_id: string): ChatAttention | null {
  return highest_session_attention(state, (target) => target.kind === "agent_session" && target.agent_id === agent_id);
}

/** 读取一个 GroupSession 的未读注意力等级；无未读时返回 null。 */
export function get_group_session_unread_attention(
  state: DesktopNotificationState,
  group_id: string,
  session_id: string,
): ChatAttention | null {
  return highest_session_attention(state, (target) => target.kind === "group_session"
    && target.group_id === group_id
    && target.session_id === session_id);
}

/** 读取一个 Group 任意 GroupSession 的未读注意力等级；无未读时返回 null。 */
export function get_group_unread_attention(state: DesktopNotificationState, group_id: string): ChatAttention | null {
  return highest_session_attention(state, (target) => target.kind === "group_session" && target.group_id === group_id);
}

/** 读取 Chat 一级导航的未读注意力等级；覆盖全部 Agent Session 与 GroupSession。 */
export function get_chat_unread_attention(state: DesktopNotificationState): ChatAttention | null {
  return highest_session_attention(state, (target) => target.kind === "agent_session" || target.kind === "group_session");
}

/** 判断一个 Power 是否存在任意未读通知。 */
export function has_unread_power_notification(state: DesktopNotificationState, power_id: string): boolean {
  return state.notifications.some((notification) => notification.target.kind === "power" && notification.target.power_id === power_id);
}

/** 将 Desktop 状态投影为当前 Power Renderer 可见的只读通知。 */
export function power_renderer_notifications(
  state: DesktopNotificationState,
  power_id: string,
): PowerRendererNotification[] {
  const topic_prefix = `power:${power_id}:`;
  return state.notifications.flatMap((notification) => {
    if (notification.target.kind !== "power" || notification.target.power_id !== power_id) return [];
    return [{
      topic_key: notification.topic_key.startsWith(topic_prefix)
        ? notification.topic_key.slice(topic_prefix.length)
        : notification.topic_key,
      title: notification.title,
      ...(notification.body ? { body: notification.body } : {}),
      route: structuredClone(notification.target.route),
      created_at: notification.created_at,
    }];
  });
}

/** 按目标条件聚合未读通知的注意力等级，始终返回最需要用户处理的那个。 */
function highest_session_attention(
  state: DesktopNotificationState,
  match: (target: DesktopNotificationTarget) => boolean,
): ChatAttention | null {
  const attentions: (ChatAttention | null)[] = state.notifications.flatMap((notification: DesktopNotification) =>
    match(notification.target) ? [attention_from_notification_kind(notification.kind)] : []);
  return highest_attention(attentions);
}
