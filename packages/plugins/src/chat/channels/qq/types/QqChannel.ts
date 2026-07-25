/**
 * QQ 渠道共享类型。
 *
 * 关键点（中文）
 * - 这里集中放 QQ 渠道的网关载荷、消息结构、状态快照等共享契约。
 * - `plugins/chat/channels/qq/*` 只消费这些类型，不再在实现文件里内联大段局部类型。
 * - 字段命名尽量保持与 QQ 官方事件/接口原始字段一致，降低映射心智负担。
 */

import type { JsonObject } from "@downcity/agent";

/**
 * QQ 渠道配置。
 */
export interface QQConfig {
  /**
   * QQ 机器人 AppId。
   */
  appId: string;
  /**
   * QQ 机器人 AppSecret。
   */
  appSecret: string;
  /**
   * 是否启用 QQ 渠道。
   */
  enabled: boolean;
  /**
   * 是否使用 QQ 沙箱环境。
   */
  sandbox?: boolean;
}

/**
 * QQ Gateway 通用载荷。
 */
export interface QQGatewayPayload {
  /**
   * WebSocket 操作码。
   */
  op: number;
  /**
   * 事件主体数据。
   */
  d?: JsonObject;
  /**
   * 服务端序列号。
   */
  s?: number;
  /**
   * Dispatch 事件类型。
   */
  t?: string;
}

/**
 * READY 事件中的用户信息。
 */
export interface QQReadyUser {
  /**
   * 机器人用户主键。
   */
  id?: string;
  /**
   * 机器人用户 ID 的兼容字段。
   */
  user_id?: string;
  /**
   * 机器人 openid。
   */
  openid?: string;
  /**
   * 机器人 user_openid。
   */
  user_openid?: string;
  /**
   * 用户名。
   */
  username?: string;
  /**
   * 昵称。
   */
  nickname?: string;
  /**
   * 展示名称。
   */
  name?: string;
  /**
   * bot 名称。
   */
  bot_name?: string;
  /**
   * 嵌套 user 对象。
   */
  user?: {
    /**
     * 嵌套用户名。
     */
    username?: string;
    /**
     * 嵌套昵称。
     */
    nickname?: string;
    /**
     * 嵌套展示名。
     */
    name?: string;
  };
}

/**
 * QQ 消息作者信息。
 */
export interface QQAuthor {
  /**
   * 群成员 openid。
   */
  member_openid?: string;
  /**
   * 用户 openid。
   */
  user_openid?: string;
  /**
   * 通用 openid。
   */
  openid?: string;
  /**
   * union openid。
   */
  union_openid?: string;
  /**
   * 用户 ID。
   */
  id?: string;
  /**
   * 兼容 user_id 字段。
   */
  user_id?: string;
  /**
   * tiny id。
   */
  tiny_id?: string;
  /**
   * 群成员 tiny id。
   */
  member_tinyid?: string;
  /**
   * 用户 tiny id。
   */
  user_tinyid?: string;
  /**
   * 兼容 uid 字段。
   */
  uid?: string;
  /**
   * 昵称。
   */
  nickname?: string;
  /**
   * 用户名。
   */
  username?: string;
  /**
   * 展示名。
   */
  name?: string;
  /**
   * 嵌套 user 信息。
   */
  user?: {
    /**
     * 嵌套用户 ID。
     */
    id?: string;
    /**
     * 嵌套兼容 user_id。
     */
    user_id?: string;
    /**
     * 嵌套 openid。
     */
    openid?: string;
    /**
     * 嵌套 user_openid。
     */
    user_openid?: string;
    /**
     * 嵌套用户名。
     */
    username?: string;
    /**
     * 嵌套昵称。
     */
    nickname?: string;
    /**
     * 嵌套展示名。
     */
    name?: string;
  };
  /**
   * 成员角色。
   */
  member_role?: string;
  /**
   * 兼容 role 字段。
   */
  role?: string;
  /**
   * 权限描述。
   */
  permissions?: string;
  /**
   * 兼容 permission 字段。
   */
  permission?: string;
}

/**
 * QQ mention 用户。
 */
export interface QQMentionUser {
  /**
   * 用户 ID。
   */
  id?: string;
  /**
   * 兼容 user_id。
   */
  user_id?: string;
  /**
   * 群成员 openid。
   */
  member_openid?: string;
  /**
   * 用户 openid。
   */
  user_openid?: string;
}

/**
 * QQ 消息引用。
 */
export interface QQMessageReference {
  /**
   * 被引用消息 ID。
   */
  message_id?: string;
  /**
   * 兼容 msg_id。
   */
  msg_id?: string;
  /**
   * 通用引用 ID。
   */
  id?: string;
}

/**
 * QQ reply_to_message 结构。
 */
export interface QQReplyToMessage {
  /**
   * 被回复消息 ID。
   */
  id?: string;
  /**
   * 被回复消息作者。
   */
  author?: QQAuthor;
}

/**
 * QQ 入站消息数据。
 */
export interface QQMessageData {
  /**
   * 当前消息 ID。
   */
  id?: string;
  /**
   * 群 openid。
   */
  group_openid?: string;
  /**
   * 群 ID。
   */
  group_id?: string;
  /**
   * 群 code。
   */
  group_code?: string;
  /**
   * 群 uin。
   */
  group_uin?: string;
  /**
   * 频道 ID。
   */
  channel_id?: string;
  /**
   * guild ID。
   */
  guild_id?: string;
  /**
   * 用户 openid。
   */
  user_openid?: string;
  /**
   * 通用 openid。
   */
  openid?: string;
  /**
   * 作者 ID。
   */
  author_id?: string;
  /**
   * 文本内容。
   */
  content?: string;
  /**
   * 作者对象。
   */
  author?: QQAuthor;
  /**
   * 提及用户列表。
   */
  mentions?: QQMentionUser[];
  /**
   * 消息引用。
   */
  message_reference?: QQMessageReference;
  /**
   * 兼容 reference。
   */
  reference?: QQMessageReference;
  /**
   * reply_to_message 结构。
   */
  reply_to_message?: QQReplyToMessage;
  /**
   * 原始附件列表。
   */
  attachments?: unknown[] | string;
  /**
   * 原始 files 字段。
   */
  files?: unknown[] | string;
  /**
   * 原始 file_info 字段。
   */
  file_info?: unknown | unknown[] | string;
  /**
   * 原始 file_infos 字段。
   */
  file_infos?: unknown[] | string;
  /**
   * 原始 media 字段。
   */
  media?: unknown | unknown[] | string;
  /**
   * 原始 medias 字段。
   */
  medias?: unknown[] | string;
  /**
   * 原始 audio 字段。
   */
  audio?: unknown | string;
  /**
   * 原始 voice 字段。
   */
  voice?: unknown | string;
}

/**
 * QQ 发送消息请求体。
 */
export interface QQSendMessageBody {
  /**
   * 文本消息内容。
   */
  content: string;
  /**
   * 消息类型。
   */
  msg_type: number;
  /**
   * 被动回复所需的消息 ID。
   */
  msg_id: string;
  /**
   * 同一消息链路内的顺序号。
   */
  msg_seq: number;
}

/**
 * QQ 作者归一化结果。
 */
export interface QqActorIdentity {
  /**
   * 归一化后的用户 ID。
   */
  user_id?: string;
  /**
   * 归一化后的展示名。
   */
  username?: string;
}

/**
 * QQ 网关状态快照。
 */
export interface QqGatewayRuntimeStatus {
  /**
   * 网关流程是否处于运行态。
   */
  running: boolean;
  /**
   * 链路可用性状态。
   */
  linkState: "connected" | "disconnected" | "unknown";
  /**
   * 面向诊断的状态文本。
   */
  statusText: string;
  /**
   * 诊断明细。
   */
  detail: Record<string, string | number | boolean | null>;
}

/**
 * QQ Gateway Dispatch 回调。
 */
export interface QqDispatchHandler {
  /**
   * 事件类型。
   */
  eventType: string;
  /**
   * 事件数据体。
   */
  data: JsonObject;
}

/**
 * QQ WebSocket 操作码。
 */
export enum OpCode {
  /** 服务端推送消息。 */
  Dispatch = 0,
  /** 客户端发送心跳。 */
  Heartbeat = 1,
  /** 客户端发送鉴权。 */
  Identify = 2,
  /** 客户端恢复连接。 */
  Resume = 6,
  /** 服务端通知重连。 */
  Reconnect = 7,
  /** 无效 context。 */
  InvalidContext = 9,
  /** 服务端 Hello。 */
  Hello = 10,
  /** 心跳确认。 */
  HeartbeatAck = 11,
}

/**
 * QQ 事件类型常量。
 */
export const EventType = {
  READY: "READY",
  RESUMED: "RESUMED",
  GROUP_AT_MESSAGE_CREATE: "GROUP_AT_MESSAGE_CREATE",
  GROUP_MESSAGE_CREATE: "GROUP_MESSAGE_CREATE",
  C2C_MESSAGE_CREATE: "C2C_MESSAGE_CREATE",
  AT_MESSAGE_CREATE: "AT_MESSAGE_CREATE",
} as const;

/**
 * QQ 原始事件捕获模式。
 */
export type QQEventCaptureMode = "dispatch" | "all";

/**
 * QQ 原始事件捕获配置。
 */
export interface QQEventCaptureConfig {
  /**
   * 是否启用事件捕获。
   */
  enabled: boolean;
  /**
   * 捕获模式。
   */
  mode: QQEventCaptureMode;
  /**
   * 事件快照写入目录。
   */
  dir: string;
}
