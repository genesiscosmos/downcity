/** 使用 Desktop 平台设置仓储持久化当前未读通知集合。 */

import type { LocalSettingRepository } from "@downcity/city/local";
import type { DesktopNotification, DesktopNotificationScope, DesktopNotificationTarget } from "../../common/types/DesktopNotification.js";
import type { DesktopNotificationStorage } from "../types/notification/Notification.js";
import type { PluginJsonObject } from "@downcity/city/plugin";

const notification_settings_key = "desktop.notifications";

/** 将未读通知作为一个原子 JSON 聚合保存到 Desktop 本地数据库。 */
export class NotificationStore implements DesktopNotificationStorage {
  /** Desktop 平台级结构化设置仓储。 */
  private readonly settings: LocalSettingRepository;

  constructor(settings: LocalSettingRepository) {
    this.settings = settings;
  }

  /** 读取并过滤损坏或未来版本无法识别的通知记录。 */
  read(): DesktopNotification[] {
    const stored = this.settings.get<unknown>(notification_settings_key);
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((value) => {
      const notification = normalize_notification(value);
      return notification ? [notification] : [];
    });
  }

  /** 通过 SQLite 设置仓储原子替换当前未读集合。 */
  write(notifications: readonly DesktopNotification[]): void {
    this.settings.set(notification_settings_key, notifications);
  }
}

/** 把一条持久化记录收敛成当前 Notification 协议。 */
function normalize_notification(input: unknown): DesktopNotification | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as Partial<DesktopNotification>;
  if (candidate.kind !== "session_turn_completed" && candidate.kind !== "plugin") return null;
  const notification_id = normalize_text(candidate.notification_id);
  const topic_key = normalize_text(candidate.topic_key);
  const title = normalize_text(candidate.title);
  const created_at = Number(candidate.created_at);
  if (!notification_id || !topic_key || !title || !Number.isFinite(created_at) || created_at < 0) return null;
  try {
    const target = normalize_notification_target(candidate.target);
    const scopes = normalize_notification_scopes(candidate.scopes);
    const body = normalize_text(candidate.body);
    return {
      notification_id,
      kind: candidate.kind,
      topic_key,
      target,
      scopes,
      title,
      ...(body ? { body } : {}),
      created_at,
    };
  } catch {
    return null;
  }
}

/** 校验持久化通知的宿主生命周期作用域。 */
function normalize_notification_scopes(input: unknown): DesktopNotificationScope[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("notification scopes are invalid");
  return input.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("notification scope is invalid");
    const candidate = value as Partial<DesktopNotificationScope>;
    if (candidate.kind === "agent") {
      const agent_id = normalize_text(candidate.agent_id);
      if (!agent_id) throw new Error("notification scope is incomplete");
      return { kind: "agent", agent_id };
    }
    if (candidate.kind === "plugin") {
      const plugin_id = normalize_text(candidate.plugin_id);
      if (!plugin_id) throw new Error("notification scope is incomplete");
      return { kind: "plugin", plugin_id };
    }
    throw new Error("notification scope kind is invalid");
  });
}

/** 读取并裁剪一段可选文本。 */
function normalize_text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 校验持久化通知所指向的业务目标。 */
function normalize_notification_target(input: unknown): DesktopNotificationTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("notification target is invalid");
  const candidate = input as Partial<DesktopNotificationTarget>;
  if (candidate.kind === "agent_session") {
    const agent_id = normalize_text(candidate.agent_id);
    const workspace_id = normalize_text(candidate.workspace_id);
    const session_id = normalize_text(candidate.session_id);
    if (!agent_id || !workspace_id || !session_id) throw new Error("notification target is incomplete");
    return { kind: "agent_session", agent_id, workspace_id, session_id };
  }
  if (candidate.kind === "plugin") {
    const plugin_id = normalize_text(candidate.plugin_id);
    if (!plugin_id) throw new Error("notification target is incomplete");
    return { kind: "plugin", plugin_id, route: normalize_plugin_route(candidate.route) };
  }
  throw new Error("notification target kind is invalid");
}

/** 读取持久化的 Plugin JSON 路由。 */
function normalize_plugin_route(value: unknown): PluginJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("notification target route is invalid");
  const serialized = JSON.stringify(value);
  if (serialized.length > 32 * 1024) throw new Error("notification target route is too large");
  return JSON.parse(serialized) as PluginJsonObject;
}
