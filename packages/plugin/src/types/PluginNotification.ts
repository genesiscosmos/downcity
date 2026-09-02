/**
 * Plugin main 发布通知与 Plugin Renderer 读取未读状态的宿主协议。
 *
 * Plugin 只持有当前 Plugin 命名空间内的能力，不接触宿主通知存储、系统角标或
 * 其他 Plugin 的通知。
 */

import type { PluginJsonObject } from "./Json.js";

/** Plugin main 发布的一条宿主通知。 */
export interface PluginNotificationInput {
  /** Plugin 内稳定的聚合键；同一键的新通知替换旧的未读通知。 */
  readonly topic_key: string;

  /** 简短的用户可见标题。 */
  readonly title: string;

  /** 可选的用户可见补充说明。 */
  readonly body?: string;

  /** 打开通知时使用的当前 Plugin 工作区 JSON 路由。 */
  readonly route?: PluginJsonObject;
}

/** Plugin 要清除的一项本地通知主题。 */
export interface PluginNotificationTopicInput {
  /** Plugin 内稳定的聚合键。 */
  readonly topic_key: string;
}

/** 宿主注入给 Plugin main 的通知发布能力。 */
export interface PluginNotificationPublisher {
  /** 发布一条由当前 Plugin 拥有的通知。 */
  publish(input: PluginNotificationInput): Promise<void>;

  /** 清除当前 Plugin 命名空间内一个主题的未读通知。 */
  dismiss(input: PluginNotificationTopicInput): Promise<void>;
}

/** Plugin Renderer 可见的一条当前 Plugin 未读通知。 */
export interface PluginRendererNotification {
  /** Plugin 发布时提供的本地聚合键。 */
  readonly topic_key: string;

  /** 通知的用户可见标题。 */
  readonly title: string;

  /** 可选的用户可见补充说明。 */
  readonly body?: string;

  /** 通知指向的当前 Plugin 工作区 JSON 路由。 */
  readonly route: PluginJsonObject;

  /** 通知最近一次产生的时间戳，单位为毫秒。 */
  readonly created_at: number;
}
