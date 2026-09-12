/**
 * Downcity Desktop 的通知协议类型。
 *
 * Notification 只表达需要用户注意且尚未查看的 Desktop 事实；具体业务模块负责
 * 产生通知，主进程负责持久化、聚合和已读生命周期。
 */

import type { PluginJsonObject } from "@downcity/city/plugin";

/** Agent Session 通知所指向的稳定业务对象。 */
export interface DesktopAgentSessionNotificationTarget {
  /** 通知目标类型，用于安全区分后续新增的目标。 */
  kind: "agent_session";
  /** 目标 Session 所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 目标 Session 所属 Workspace 的稳定标识。 */
  workspace_id: string;
  /** 目标 Session 的稳定标识。 */
  session_id: string;
}

/** GroupSession 通知所指向的稳定业务对象。 */
export interface DesktopGroupSessionNotificationTarget {
  /** 通知目标类型，用于安全区分后续新增的目标。 */
  kind: "group_session";
  /** 目标 GroupSession 所属 Group 的稳定标识。 */
  group_id: string;
  /** 目标 GroupSession 的稳定标识。 */
  session_id: string;
}

/** Plugin 通知所指向的受控业务工作区路由。 */
export interface DesktopPluginNotificationTarget {
  /** 通知目标类型。 */
  kind: "plugin";
  /** 目标 Plugin 的稳定标识，由宿主绑定而不是由 Plugin 输入。 */
  plugin_id: string;
  /** 目标 Plugin 工作区内部的 JSON 路由。 */
  route: PluginJsonObject;
}

/** Desktop 通知可以关联的业务目标。 */
export type DesktopNotificationTarget =
  | DesktopAgentSessionNotificationTarget
  | DesktopGroupSessionNotificationTarget
  | DesktopPluginNotificationTarget;

/** Desktop 通知随业务对象结束而清理的生命周期作用域。 */
export type DesktopNotificationScope =
  | {
    /** Agent 生命周期作用域。 */
    readonly kind: "agent";
    /** 拥有该通知的 Agent 稳定标识。 */
    readonly agent_id: string;
  }
  | {
    /** Group 生命周期作用域。 */
    readonly kind: "group";
    /** 拥有该通知的 Group 稳定标识。 */
    readonly group_id: string;
  }
  | {
    /** Plugin 生命周期作用域。 */
    readonly kind: "plugin";
    /** 拥有该通知的 Plugin 稳定标识。 */
    readonly plugin_id: string;
  };

/**
 * Desktop 当前支持的通知类型。
 *
 * Session 与 Group 需要用户注意的每种落点各自成类，便于消费方区分注意力等级；
 * 同一目标的不同落点仍按同一聚合键收敛为一条未读通知。
 */
export type DesktopNotificationKind =
  | "session_turn_completed"
  | "session_turn_waiting_input"
  | "session_turn_failed"
  | "group_interaction_pending"
  | "group_turn_failed"
  | "plugin";

/** Renderer 可见的一条未读通知。 */
export interface DesktopNotification {
  /** 通知实例的稳定标识。 */
  notification_id: string;
  /** 通知生产者定义的类型。 */
  kind: DesktopNotificationKind;
  /** 同类通知的稳定聚合键；相同键只保留最新一条未读通知。 */
  topic_key: string;
  /** 通知关联的业务目标。 */
  target: DesktopNotificationTarget;
  /** 由宿主绑定的生命周期作用域；任一作用域结束时通知随之清理。 */
  scopes: DesktopNotificationScope[];
  /** 通知的简短用户可见标题。 */
  title: string;
  /** 通知的可选用户可见补充说明。 */
  body?: string;
  /** 通知最近一次产生的时间戳，单位为毫秒。 */
  created_at: number;
}

/** 主进程向 Renderer 投影的完整未读通知状态。 */
export interface DesktopNotificationState {
  /** 当前主进程生命周期内单调递增的状态修订号。 */
  revision: number;
  /** 当前全部未读通知，按产生时间倒序排列。 */
  notifications: DesktopNotification[];
  /** 当前未读通知数量，同时用于系统应用图标角标。 */
  unread_count: number;
}

/** Renderer 向主进程报告的当前通知目标观察状态。 */
export interface DesktopNotificationViewState {
  /** 当前主视图正在展示的通知目标；非通知目标页面不提供。 */
  target?: DesktopNotificationTarget;
  /** 当前窗口是否可见、获得焦点且能够被用户实际查看。 */
  visible: boolean;
}
