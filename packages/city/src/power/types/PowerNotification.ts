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
  category: string;
  /** 原 Session 标识。 */
  session_id: string;
  /** Session 角色，用于 Chat 和 Work 的导航投影。 */
  origin_type: string;
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

/** City 集合生命周期及 Group 运行事实，不包含通知策略或私密响应。 */
export type PowerNotificationFact =
  | { /** 活动目标目录发生变化。 */ type: "targets_changed" }
  | { /** 生命周期事实。 */ type: "target_removed"; /** 离开活动集合的目标。 */ target: PowerNotificationTarget; /** 原主体确认的归档或删除原因。 */ reason: "archived" | "removed" }
  | { /** 主体移除事实。 */ type: "agent_removed"; /** 已移除主体。 */ agent_id: string }
  | { /** 群组移除事实。 */ type: "group_removed"; /** 已移除群组。 */ group_id: string }
  | { /** 群聊的原始状态事件。 */ type: "group_event"; /** 持有群聊的 Group。 */ group_id: string; /** 原群聊。 */ session_id: string; /** 原始状态或交互事件。 */ event: import("@downcity/agent").GroupEvent };

/** 当前可打开的目标目录；不可枚举的主体单独保留未知状态。 */
export interface PowerNotificationTargets {
  /** 活动 Session 与 GroupSession 稳定目标。 */
  targets: PowerNotificationTarget[];
  /** 已归档来源，保留摘要但不能作为活动会话打开。 */
  archived_targets: PowerNotificationTarget[];
  /** 当前已登记 Agent，用于区分来源移除和目录暂时不可达。 */
  agent_ids: string[];
  /** 当前已登记 Group，用于区分来源移除和目录暂时不可达。 */
  group_ids: string[];
  /** 目标当前绑定的 Workspace，只作可达性核对，不参与稳定身份。 */
  target_workspaces: Record<string, string>;
  /** 以通知目标稳定键索引的真实 Session 标题；含活动与归档元数据，空字符串表示尚未命名。 */
  target_titles: Record<string, string>;
  /** 当前 City 已登记 Workspace 的稳定标识。 */
  workspace_ids: string[];
  /** 目录读取失败的 Agent。 */
  unavailable_agents: string[];
  /** 目录读取失败的 Group。 */
  unavailable_groups: string[];
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
