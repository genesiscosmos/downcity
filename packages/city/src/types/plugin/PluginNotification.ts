/**
 * Agent Plugin 向宿主发布用户注意事项的通知协议。
 *
 * Plugin 只描述通知内容与自身工作区路由，不感知 Desktop、Dock、持久化或已读策略。
 * 宿主负责绑定 Plugin 身份、聚合通知并决定具体呈现方式。
 */

import type { JsonObject } from "@downcity/agent";

/** Agent Plugin 发布的一条宿主通知。 */
export interface PluginNotificationInput {
  /** Plugin 内稳定的聚合键；同一键的新通知替换旧的未读通知。 */
  readonly topic_key: string;

  /** 简短的用户可见标题。 */
  readonly title: string;

  /** 可选的用户可见补充说明。 */
  readonly body?: string;

  /** 打开通知时使用的当前 Plugin 工作区 JSON 路由。 */
  readonly route?: JsonObject;
}

/** Plugin 要清除的一项本地通知主题。 */
export interface PluginNotificationTopicInput {
  /** Plugin 内稳定的聚合键。 */
  readonly topic_key: string;
}

/** 宿主注入给 Agent Plugin factory 的通知发布能力。 */
export interface PluginNotificationPublisher {
  /** 发布一条由当前 Plugin 拥有的通知。 */
  publish(input: PluginNotificationInput): Promise<void>;

  /** 清除当前 Plugin 命名空间内一个主题的未读通知。 */
  dismiss(input: PluginNotificationTopicInput): Promise<void>;
}
