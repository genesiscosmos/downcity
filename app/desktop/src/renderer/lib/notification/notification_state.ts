/** Desktop Notification 在 Renderer 中的只读查询与导航目标投影。 */

import type {
  DesktopAgentSessionNotificationTarget,
  DesktopNotificationTarget,
  DesktopNotificationState,
} from "../../../common/types/DesktopNotification";
import type { PluginJsonObject } from "@downcity/plugin";
import type { PluginRendererNotification } from "@downcity/plugin/react";
import type { NavigationTarget } from "../../types/DesktopView";

/** 创建 Agent Session 的稳定通知目标。 */
export function create_agent_session_notification_target(
  workspace_id: string,
  agent_id: string,
  session_id: string,
): DesktopAgentSessionNotificationTarget {
  return { kind: "agent_session", workspace_id, agent_id, session_id };
}

/** 将当前页面导航投影为可被 Notification 识别的目标。 */
export function notification_target_from_navigation(
  target: NavigationTarget | null,
  plugin_routes: Readonly<Record<string, PluginJsonObject>> = {},
): DesktopNotificationTarget | undefined {
  if (target?.kind === "session") {
    return create_agent_session_notification_target(target.workspace_id, target.agent_id, target.session_id);
  }
  if (target?.kind === "plugin_workspace" || target?.kind === "plugin") {
    return {
      kind: "plugin",
      plugin_id: target.plugin_id,
      route: target.kind === "plugin_workspace" ? structuredClone(plugin_routes[target.plugin_id] ?? {}) : {},
    };
  }
  return undefined;
}

/** 判断一个 Agent Session 是否存在未读通知。 */
export function has_unread_session_notification(
  state: DesktopNotificationState,
  workspace_id: string,
  agent_id: string,
  session_id: string,
): boolean {
  return state.notifications.some((notification) => notification.target.kind === "agent_session"
    && notification.target.workspace_id === workspace_id
    && notification.target.agent_id === agent_id
    && notification.target.session_id === session_id);
}

/** 判断一个 Agent 是否有任意 Session 未读通知。 */
export function has_unread_agent_notification(state: DesktopNotificationState, agent_id: string): boolean {
  return state.notifications.some((notification) => notification.target.kind === "agent_session" && notification.target.agent_id === agent_id);
}

/** 判断 Chat 一级导航是否存在任意 Session 未读通知。 */
export function has_unread_chat_notification(state: DesktopNotificationState): boolean {
  return state.notifications.some((notification) => notification.target.kind === "agent_session");
}

/** 判断一个 Plugin 是否存在任意未读通知。 */
export function has_unread_plugin_notification(state: DesktopNotificationState, plugin_id: string): boolean {
  return state.notifications.some((notification) => notification.target.kind === "plugin" && notification.target.plugin_id === plugin_id);
}

/** 将 Desktop 状态投影为当前 Plugin Renderer 可见的只读通知。 */
export function plugin_renderer_notifications(
  state: DesktopNotificationState,
  plugin_id: string,
): PluginRendererNotification[] {
  const topic_prefix = `plugin:${plugin_id}:`;
  return state.notifications.flatMap((notification) => {
    if (notification.target.kind !== "plugin" || notification.target.plugin_id !== plugin_id) return [];
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
