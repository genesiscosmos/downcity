/** Desktop Notification 领域的内部端口类型。 */

import type {
  DesktopNotification,
  DesktopNotificationKind,
  DesktopNotificationScope,
  DesktopNotificationState,
  DesktopNotificationTarget,
} from "../../../common/types/DesktopNotification.js";
import type { PluginJsonObject } from "@downcity/city/plugin";

/** NotificationController 的可替换运行依赖。 */
export interface NotificationControllerOptions {
  /** 创建新的通知稳定标识。 */
  create_id(): string;
}

/** 通知生产者提交给 NotificationController 的完整输入。 */
export interface DesktopNotificationInput {
  /** 通知生产者定义的类型。 */
  kind: DesktopNotificationKind;
  /** 同类通知的稳定聚合键。 */
  topic_key: string;
  /** 通知关联的业务目标。 */
  target: DesktopNotificationTarget;
  /** 通知所属的宿主生命周期作用域。 */
  scopes: readonly DesktopNotificationScope[];
  /** 通知的简短用户可见标题。 */
  title: string;
  /** 通知的可选用户可见补充说明。 */
  body?: string;
  /** 通知产生时间戳，单位为毫秒。 */
  created_at: number;
}

/** Plugin 发布入口可以提交的宿主无关通知内容。 */
export interface DesktopPluginNotificationInput {
  /** Plugin 内稳定的聚合键。 */
  readonly topic_key: string;
  /** 简短的用户可见标题。 */
  readonly title: string;
  /** 可选的用户可见补充说明。 */
  readonly body?: string;
  /** 当前 Plugin 工作区内的可选 JSON 路由。 */
  readonly route?: PluginJsonObject;
}

/** NotificationController 使用的持久化端口。 */
export interface DesktopNotificationStorage {
  /** 读取全部仍处于未读状态的通知。 */
  read(): DesktopNotification[];
  /** 原子替换全部仍处于未读状态的通知。 */
  write(notifications: readonly DesktopNotification[]): void;
}

/** 系统应用图标角标端口。 */
export interface DesktopNotificationBadge {
  /** 将角标更新为当前未读数量；零表示清除角标。 */
  update(unread_count: number): void;
}

/** NotificationController 对外发布的状态事件。 */
export interface DesktopNotificationEvents {
  /** 未读通知发生变化时广播完整状态快照。 */
  state_changed(state: DesktopNotificationState): void;
}

/** 业务通知生产者依赖的最小发布端口。 */
export interface DesktopNotificationPublisher {
  /** 发布或按 topic_key 聚合一条未读通知。 */
  publish(input: DesktopNotificationInput): DesktopNotification | null;

  /** 按完整聚合键清除一条未读通知。 */
  mark_topic_read(topic_key: string): void;
}
