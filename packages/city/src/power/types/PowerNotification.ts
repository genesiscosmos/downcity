/**
 * Power 发布通知与 Power Renderer 读取未读状态的宿主协议。
 *
 * Power 只持有当前 Power 命名空间内的能力，不接触宿主通知存储、系统角标或
 * 其他 Power 的通知。
 */

import type { PowerJsonObject } from "./Json.js";

/** Session 稳定目标，不携带会变化的 Workspace 绑定。 */
export interface PowerNotificationSessionTarget {
  /** 来源为 Agent Session。 */
  kind: "agent_session";
  /** 持有原 Session 的 Agent。 */
  agent_id: string;
  /** Session 存储分区。 */
  type: string;
  /** 原 Session 标识。 */
  session_id: string;
  /** Session 角色，用于 Chat 和 Work 的导航投影。 */
  session_kind: string;
}

/** GroupSession 稳定目标。 */
export interface PowerNotificationGroupTarget {
  /** 来源为 GroupSession。 */
  kind: "group_session";
  /** 持有原群聊的 Group。 */
  group_id: string;
  /** 原群聊标识。 */
  session_id: string;
}

/** 业务 Power 的导航目标；路由只用于打开业务页面。 */
export interface PowerNotificationPowerTarget {
  /** 来源为业务 Power。 */
  kind: "power";
  /** 由受信发布端口绑定的 Power 标识。 */
  power_id: string;
  /** 业务页面内部路由。 */
  route: PowerJsonObject;
}

/** 所有通知消费者使用的目标协议。 */
export type PowerNotificationTarget = PowerNotificationSessionTarget | PowerNotificationGroupTarget | PowerNotificationPowerTarget;

/** 通知含义独立于 Session、Group 或业务 Power 来源。 */
export type PowerNotificationKind = "reply" | "update" | "request";

/** Inbox 关注事项与仅会话未读共享状态所有者，但分别投影和计数。 */
export type PowerNotificationScope = "inbox" | "session";

/** 明确表达业务结果，消费者不得从标题判断成功或失败。 */
export type PowerNotificationOutcome = "success" | "failure" | "info";

/** 来源状态只描述可达性；不会隐含删除通知或完成请求。 */
export type PowerNotificationAvailability = "available" | "archived" | "removed" | "unknown";

/** 群聊原始运行事实；通知不维护主体目录或生命周期副本。 */
export interface PowerNotificationFact {
  /** 仅转发群聊执行事件。 */
  type: "group_event";
  /** 原群聊所属主体。 */
  group_id: string;
  /** 原群聊会话。 */
  session_id: string;
  /** 原始执行或交互事实。 */
  event: import("@downcity/agent").GroupEvent;
}

/** 一条明确来源的只读解析结果；不持久化可达性或目录副本。 */
export interface PowerNotificationResolution {
  /** 原目标；活动逻辑引用解析成功后补齐存储记录身份。 */
  target: PowerNotificationTarget;
  /** 当前来源可达性，读取失败保留 unknown。 */
  availability: PowerNotificationAvailability;
  /** 来源真实标题；undefined 表示不可读取，空字符串表示未命名。 */
  title?: string;
}

/** Power 发布的一条宿主通知。 */
export interface PowerNotificationInput {
  /** Power 内稳定的聚合键；同一键的新通知替换旧的未读通知。 */
  readonly topic_key: string;

  /** 原事件的幂等身份；不同 Run/Turn 可更新同一事项，即使摘要相同也恢复未读。 */
  readonly event_id?: string;

  /** 简短的用户可见标题。 */
  readonly title: string;

  /** 可选的用户可见补充说明。 */
  readonly body?: string;

  /** 打开通知时使用的当前 Power 工作区 JSON 路由。 */
  readonly route?: PowerJsonObject;

  /** 原生来源的稳定目标；Workspace 绑定不参与通知身份。 */
  readonly target?: PowerNotificationTarget;

  /** 更新语义；原 Interaction 请求只在查询中投影。 */
  readonly kind: "reply" | "update";
  /** 是否进入 Inbox；会话回复只在会话入口显示未读。 */
  readonly scope: PowerNotificationScope;
  /** 业务结果，独立于用户可见标题。 */
  readonly outcome: PowerNotificationOutcome;
}

/** 由宿主绑定发布主体与命名空间，通知接收器不接收模型伪造身份。 */
export interface PowerNotificationSource {
  /** 事实提供者的业务类别，独立于目标与通知语义。 */
  source_kind: "session" | "group" | "power";
  /** 发布通知的Power稳定标识。 */
  power_id: string;
  /** 可选的Agent执行范围，未绑定时表示City级业务通知。 */
  agent_id?: string;
}

/** Notification Power登记的唯一接收器；不向模型暴露。 */
export interface PowerNotificationReceiver {
  /** 原主体交互集合发生变化；仅提示刷新，不复制交互状态。 */
  interactions_changed?(): void;
  /** 来源元数据发生变化；仅失效快照，不等待查询或持久化。 */
  sources_changed?(): void;
  /** City 的集合与群聊事实；展示策略完全由接收 Power 决定。 */
  fact_changed?(fact: PowerNotificationFact): void | Promise<void>;
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
  /** 完整来源命名空间内唯一的通知身份；已读动作同时校验 created_at。 */
  readonly notification_id: string;
  /** Power 发布时提供的本地聚合键。 */
  readonly topic_key: string;

  /** 通知的用户可见标题。 */
  readonly title: string;

  /** 可选的用户可见补充说明。 */
  readonly body?: string;

  /** 通知指向的当前 Power 工作区 JSON 路由。 */
  readonly route: PowerJsonObject;

  /** 业务结果，便于业务页面明确显示失败等状态。 */
  readonly outcome: PowerNotificationOutcome;

  /** 通知最近一次产生的时间戳，单位为毫秒。 */
  readonly created_at: number;
}
