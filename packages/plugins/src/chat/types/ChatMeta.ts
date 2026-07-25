/**
 * ChatMeta：chat plugin runtime 维护的 session 路由元信息。
 *
 * 关键点（中文）
 * - 只描述“如何把 session_id 路由回平台 chat”
 * - 由 chat plugin runtime 在接收入站消息时更新
 * - 不属于 core context message schema
 */

import type { ChatDispatchChannel } from "./ChatDispatcher.js";

export type ChatMetaV1 = {
  /** schema 版本 */
  v: 1;
  /** 更新时间戳（ms） */
  updated_at: number;
  /** 会话 ID */
  session_id: string;
  /** 平台通道 */
  channel: ChatDispatchChannel;
  /** 平台 chatId */
  chatId: string;
  /** 平台 chatType（group/private/topic/c2c/channel...） */
  targetType?: string;
  /** 平台 thread/topic ID */
  threadId?: number;
  /** 平台最近消息 ID（QQ/部分平台回包依赖） */
  message_id?: string;
  /** 最近发言用户 ID */
  actorId?: string;
  /** 最近发言用户昵称 */
  actorName?: string;
  /** 会话展示名（群名/频道名/私聊对象名） */
  chatTitle?: string;
};
