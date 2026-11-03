/**
 * Power 发布通知与 Power Renderer 读取未读状态的宿主协议。
 *
 * Power 只持有当前 Power 命名空间内的能力，不接触宿主通知存储、系统角标或
 * 其他 Power 的通知。
 */

import type { PowerJsonObject } from "./Json.js";

/** Power 发布的一条宿主通知。 */
export interface PowerNotificationInput {
  /** Power 内稳定的聚合键；同一键的新通知替换旧的未读通知。 */
  readonly topic_key: string;

  /** 简短的用户可见标题。 */
  readonly title: string;

  /** 可选的用户可见补充说明。 */
  readonly body?: string;

  /** 打开通知时使用的当前 Power 工作区 JSON 路由。 */
  readonly route?: PowerJsonObject;
}

/** 由宿主绑定发布主体与命名空间，通知接收器不接收模型伪造身份。 */
export interface PowerNotificationSource {
  /** 发布通知的Power稳定标识。 */
  power_id: string;
  /** 可选的Agent执行范围，未绑定时表示City级业务通知。 */
  agent_id?: string;
}

/** Notification Power登记的唯一接收器；不向模型暴露。 */
export interface PowerNotificationReceiver {
  /** 原主体交互集合发生变化；仅提示刷新，不复制交互状态。 */
  interactions_changed?(): void;
  /** 将来源通知持久化后才确认成功。 */
  publish(source: PowerNotificationSource, input: PowerNotificationInput): Promise<void>;
  /** 撤销来源的展示主题，不改变Interaction或业务工作状态。 */
  dismiss(source: PowerNotificationSource, input: PowerNotificationTopicInput): Promise<void>;
}

/** Power 要清除的一项本地通知主题。 */
export interface PowerNotificationTopicInput {
  /** Power 内稳定的聚合键。 */
  readonly topic_key: string;
}

/** 宿主注入给 Power 的通知发布能力。 */
export interface PowerNotificationPublisher {
  /** 发布一条由当前 Power 拥有的通知。 */
  publish(input: PowerNotificationInput): Promise<void>;

  /** 清除当前 Power 命名空间内一个主题的未读通知。 */
  dismiss(input: PowerNotificationTopicInput): Promise<void>;
}

/** Power Renderer 可见的一条当前 Power 未读通知。 */
export interface PowerRendererNotification {
  /** Power 发布时提供的本地聚合键。 */
  readonly topic_key: string;

  /** 通知的用户可见标题。 */
  readonly title: string;

  /** 可选的用户可见补充说明。 */
  readonly body?: string;

  /** 通知指向的当前 Power 工作区 JSON 路由。 */
  readonly route: PowerJsonObject;

  /** 通知最近一次产生的时间戳，单位为毫秒。 */
  readonly created_at: number;
}
