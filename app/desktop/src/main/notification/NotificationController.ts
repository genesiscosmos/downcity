/**
 * Desktop 未读通知的唯一事实源。
 *
 * 控制器负责聚合、持久化、已读生命周期和角标同步，不理解 Session、Task 或
 * Power 等具体通知生产者。
 */

import { randomUUID } from "node:crypto";
import type {
  DesktopNotification,
  DesktopNotificationScope,
  DesktopNotificationState,
  DesktopNotificationTarget,
  DesktopNotificationViewState,
} from "../../common/types/DesktopNotification.js";
import type {
  DesktopNotificationBadge,
  DesktopNotificationEvents,
  DesktopNotificationInput,
  DesktopNotificationPublisher,
  DesktopNotificationStorage,
  NotificationControllerOptions,
} from "../types/notification/Notification.js";
import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";

const default_options: NotificationControllerOptions = { create_id: () => randomUUID() };

/** 管理 Desktop 当前全部未读通知及各窗口正在查看的目标。 */
export class NotificationController implements DesktopNotificationPublisher {
  /** 未读通知的持久化端口。 */
  private readonly storage: DesktopNotificationStorage;
  /** 系统应用图标角标端口。 */
  private readonly badge: DesktopNotificationBadge;
  /** 通知状态广播端口。 */
  private readonly events: DesktopNotificationEvents;
  /** 可替换的通知运行选项。 */
  private readonly options: NotificationControllerOptions;
  /** 当前仍未被用户查看的通知。 */
  private notifications: DesktopNotification[];
  /** 当前进程内的通知状态修订号。 */
  private revision = 0;
  /** 每个 Renderer 当前实际可见的通知目标。 */
  private readonly visible_targets_by_view = new Map<number, DesktopNotificationTarget>();

  constructor(
    storage: DesktopNotificationStorage,
    badge: DesktopNotificationBadge,
    events: DesktopNotificationEvents,
    options: NotificationControllerOptions = default_options,
  ) {
    this.storage = storage;
    this.badge = badge;
    this.events = events;
    this.options = options;
    const stored_notifications = storage.read();
    this.notifications = deduplicate_notifications(stored_notifications);
    if (this.notifications.length !== stored_notifications.length) storage.write(this.notifications);
    this.badge.update(this.notifications.length);
  }

  /** 返回当前完整未读通知状态。 */
  get_state(): DesktopNotificationState {
    return { revision: this.revision, notifications: this.notifications.map(copy_notification), unread_count: this.notifications.length };
  }

  /** 发布通知；正在被用户查看的目标不会进入未读集合。 */
  publish(input: DesktopNotificationInput): DesktopNotification | null {
    const normalized = normalize_notification_input(input);
    if (this.is_target_visible(normalized.target)) {
      this.mark_target_read(normalized.target);
      return null;
    }
    const previous = this.notifications.find((item) => item.topic_key === normalized.topic_key);
    const notification: DesktopNotification = {
      notification_id: previous?.notification_id ?? this.options.create_id(),
      ...normalized,
      scopes: [...normalized.scopes],
    };
    this.commit([
      notification,
      ...this.notifications.filter((item) => item.topic_key !== notification.topic_key),
    ]);
    return notification;
  }

  /** 将目标关联的全部通知标记为已读。 */
  mark_target_read(target_input: DesktopNotificationTarget): void {
    this.mark_targets_read([target_input]);
  }

  /** 按完整聚合键清除一条未读通知。 */
  mark_topic_read(topic_key_input: string): void {
    const topic_key = require_text(topic_key_input, "topic_key");
    const next = this.notifications.filter((notification) => notification.topic_key !== topic_key);
    if (next.length === this.notifications.length) return;
    this.commit(next);
  }

  /** 将多个业务目标关联的全部通知一次性标记为已读。 */
  mark_targets_read(target_inputs: readonly DesktopNotificationTarget[]): void {
    const target_keys = new Set(target_inputs.map((target) => get_notification_target_key(normalize_notification_target(target))));
    if (target_keys.size === 0) return;
    const next = this.notifications.filter((notification) => !target_keys.has(get_notification_target_key(notification.target)));
    if (next.length === this.notifications.length) return;
    this.commit(next);
  }

  /** 将一个宿主生命周期作用域内的全部通知标记为已读。 */
  mark_scope_read(scope_input: DesktopNotificationScope): void {
    const scope_key = get_notification_scope_key(normalize_notification_scope(scope_input));
    const next = this.notifications.filter((notification) => !notification.scopes.some(
      (scope) => get_notification_scope_key(scope) === scope_key,
    ));
    if (next.length === this.notifications.length) return;
    this.commit(next);
  }

  /** 更新一个 Renderer 实际可见的业务目标，并在可见时完成已读收口。 */
  set_view_state(view_id: number, state: DesktopNotificationViewState): void {
    if (!Number.isInteger(view_id) || view_id < 0) throw new Error("notification view_id is invalid");
    if (!state.visible || !state.target) {
      this.visible_targets_by_view.delete(view_id);
      return;
    }
    const target = normalize_notification_target(state.target);
    this.visible_targets_by_view.set(view_id, target);
    this.mark_target_read(target);
  }

  /** Renderer 销毁时释放其目标观察状态。 */
  remove_view(view_id: number): void {
    this.visible_targets_by_view.delete(view_id);
  }

  /** 原子提交通知状态，并统一更新 Renderer 与系统角标。 */
  private commit(notifications: readonly DesktopNotification[]): void {
    this.notifications = sort_notifications(notifications);
    this.revision += 1;
    this.storage.write(this.notifications);
    const state = this.get_state();
    this.badge.update(state.unread_count);
    this.events.state_changed(state);
  }

  /** 判断任一存活 Renderer 是否正在实际查看目标。 */
  private is_target_visible(target: DesktopNotificationTarget): boolean {
    const target_key = get_notification_target_key(target);
    return [...this.visible_targets_by_view.values()].some((candidate) => get_notification_target_key(candidate) === target_key);
  }
}

/** 校验并复制一条生产者输入，阻止可变对象进入控制器状态。 */
function normalize_notification_input(input: DesktopNotificationInput): DesktopNotificationInput {
  const topic_key = require_text(input.topic_key, "topic_key");
  const title = require_text(input.title, "title");
  const created_at = Number(input.created_at);
  if (!Number.isFinite(created_at) || created_at < 0) throw new Error("notification created_at is invalid");
  const body = typeof input.body === "string" ? input.body.trim() : "";
  return {
    kind: input.kind,
    topic_key,
    target: normalize_notification_target(input.target),
    scopes: normalize_notification_scopes(input.scopes),
    title,
    ...(body ? { body } : {}),
    created_at,
  };
}

/** 规范化通知生产者提供的必填文本。 */
function require_text(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`notification ${field} is required`);
  return normalized;
}

/** 统一通知状态的稳定展示顺序。 */
function sort_notifications(notifications: readonly DesktopNotification[]): DesktopNotification[] {
  return [...notifications].sort((left, right) => right.created_at - left.created_at || left.notification_id.localeCompare(right.notification_id));
}

/** 恢复时按 topic_key 保留最新记录，继续维护未读聚合不变量。 */
function deduplicate_notifications(notifications: readonly DesktopNotification[]): DesktopNotification[] {
  const topics = new Set<string>();
  return sort_notifications(notifications).filter((notification) => {
    if (topics.has(notification.topic_key)) return false;
    topics.add(notification.topic_key);
    return true;
  });
}

/** 校验未知输入并返回规范化后的通知目标。 */
function normalize_notification_target(input: unknown): DesktopNotificationTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("notification target is invalid");
  const candidate = input as Partial<DesktopNotificationTarget>;
  if (candidate.kind === "agent_session") {
    const agent_id = require_text(candidate.agent_id, "target agent_id");
    const workspace_id = require_text(candidate.workspace_id, "target workspace_id");
    const session_id = require_text(candidate.session_id, "target session_id");
    return { kind: "agent_session", agent_id, workspace_id, session_id };
  }
  if (candidate.kind === "group_session") {
    return {
      kind: "group_session",
      group_id: require_text(candidate.group_id, "target group_id"),
      session_id: require_text(candidate.session_id, "target session_id"),
    };
  }
  if (candidate.kind === "power") {
    return {
      kind: "power",
      power_id: require_text(candidate.power_id, "target power_id"),
      route: normalize_power_route(candidate.route),
    };
  }
  throw new Error("notification target kind is invalid");
}

/** 为通知目标生成不依赖展示文案的稳定比较键。 */
function get_notification_target_key(target: DesktopNotificationTarget): string {
  if (target.kind === "agent_session") return stable_json_stringify(["agent_session", target.agent_id, target.workspace_id, target.session_id]);
  if (target.kind === "group_session") return stable_json_stringify(["group_session", target.group_id, target.session_id]);
  return stable_json_stringify(["power", target.power_id, target.route]);
}

/** 校验、去重并复制通知的生命周期作用域。 */
function normalize_notification_scopes(input: readonly DesktopNotificationScope[]): DesktopNotificationScope[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("notification scopes are required");
  const scopes = input.map(normalize_notification_scope);
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    const key = get_notification_scope_key(scope);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 校验并复制一个宿主生命周期作用域。 */
function normalize_notification_scope(input: unknown): DesktopNotificationScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("notification scope is invalid");
  const candidate = input as Partial<DesktopNotificationScope>;
  if (candidate.kind === "agent") return { kind: "agent", agent_id: require_text(candidate.agent_id, "scope agent_id") };
  if (candidate.kind === "group") return { kind: "group", group_id: require_text(candidate.group_id, "scope group_id") };
  if (candidate.kind === "power") return { kind: "power", power_id: require_text(candidate.power_id, "scope power_id") };
  throw new Error("notification scope kind is invalid");
}

/** 为生命周期作用域生成无分隔符碰撞的稳定比较键。 */
function get_notification_scope_key(scope: DesktopNotificationScope): string {
  if (scope.kind === "agent") return stable_json_stringify(["agent", scope.agent_id]);
  if (scope.kind === "group") return stable_json_stringify(["group", scope.group_id]);
  return stable_json_stringify(["power", scope.power_id]);
}

/** 复制一条通知，避免调用者修改控制器持有的唯一事实源。 */
function copy_notification(notification: DesktopNotification): DesktopNotification {
  return {
    ...notification,
    scopes: notification.scopes.map((scope) => ({ ...scope })),
    target: notification.target.kind === "power"
      ? { ...notification.target, route: structuredClone(notification.target.route) }
      : { ...notification.target },
  };
}

/** 校验并复制 Power 工作区 JSON 路由。 */
function normalize_power_route(value: unknown): PowerJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("notification target route is invalid");
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 32 * 1024) throw new Error("notification target route is too large");
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("notification target route is invalid");
    return parsed as PowerJsonObject;
  } catch (reason) {
    if (reason instanceof Error && reason.message.startsWith("notification target route")) throw reason;
    throw new Error("notification target route is not JSON-serializable", { cause: reason });
  }
}

/** 为 JSON 值生成不受 object 属性插入顺序影响的稳定文本。 */
function stable_json_stringify(value: PowerJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stable_json_stringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable_json_stringify(value[key] ?? null)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
