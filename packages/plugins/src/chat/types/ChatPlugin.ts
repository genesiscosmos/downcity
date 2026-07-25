/**
 * Chat plugin 交互类型定义。
 *
 * 关键点（中文）
 * - 统一描述 chat plugin runtime 与 plugin 之间的扩展 payload。
 * - chat plugin runtime 负责定义结构，plugin 只消费这些稳定字段。
 * - 字段全部保持 Json 兼容，避免把函数或运行时私有对象塞进 plugin 点。
 */

import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";

/**
 * chat 入站附件类型。
 */
export type ChatPluginAttachmentKind =
  | "document"
  | "photo"
  | "voice"
  | "audio"
  | "video"
  | "unknown";

/**
 * chat plugin 可见的入站附件描述。
 */
export interface ChatPluginAttachment {
  /**
   * 当前消息来源渠道。
   */
  channel: ChatDispatchChannel;
  /**
   * 归一化后的附件类型。
   */
  kind: ChatPluginAttachmentKind;
  /**
   * 附件本地绝对路径。
   *
   * 说明（中文）
   * - 若 chat plugin runtime 尚未把附件落地，则该字段可为空。
   * - 依赖本地文件的 plugin 应在缺失时跳过处理。
   */
  path?: string;
  /**
   * 附件展示描述。
   */
  desc?: string;
  /**
   * 附件文件名。
   */
  fileName?: string;
  /**
   * MIME 类型。
   */
  contentType?: string;
  /**
   * 平台附件 ID。
   */
  attachmentId?: string;
}

/**
 * chat 入站增强输入。
 */
export interface ChatInboundAugmentInput {
  /**
   * 当前消息来源渠道。
   */
  channel: ChatDispatchChannel;
  /**
   * 当前会话 ID。
   */
  chatId: string;
  /**
   * 当前消息所属会话类型。
   */
  chatType?: string;
  /**
   * 当前 lane / context 对应键。
   */
  chat_key?: string;
  /**
   * 当前消息 ID。
   */
  message_id?: string;
  /**
   * 当前工程根目录。
   */
  rootPath: string;
  /**
   * chat plugin runtime 已生成的附件文本块。
   *
   * 说明（中文）
   * - 一般是 `<file ...>` 标签拼接后的结果。
   */
  attachmentText?: string;
  /**
   * chat plugin runtime 已抽取的正文文本。
   */
  body_text?: string;
  /**
   * plugin 追加的中间文本块。
   *
   * 说明（中文）
   * - pipeline 默认在这里继续追加内容，例如语音转写。
   */
  pluginSections?: string[];
  /**
   * 归一化后的附件列表。
   */
  attachments: ChatPluginAttachment[];
}

/**
 * chat 回复前文本管道输入。
 */
export interface ChatReplyDispatchInput {
  /**
   * 当前消息来源渠道。
   */
  channel?: ChatDispatchChannel;
  /**
   * 当前会话 key。
   */
  chat_key: string;
  /**
   * 目标会话 ID。
   */
  chatId?: string;
  /**
   * 目标消息 ID。
   */
  message_id?: string;
  /**
   * 当前回复文本。
   */
  text: string;
  /**
   * 当前回复阶段。
   */
  phase: "step" | "final" | "error";
  /**
   * 当前分发模式。
   */
  mode: "direct" | "fallback";
}

/**
 * chat 回复后事件输入。
 */
export interface ChatReplyEffectInput {
  /**
   * 当前消息来源渠道。
   */
  channel?: ChatDispatchChannel;
  /**
   * 当前会话 key。
   */
  chat_key: string;
  /**
   * 目标会话 ID。
   */
  chatId?: string;
  /**
   * 目标消息 ID。
   */
  message_id?: string;
  /**
   * 最终尝试发送的文本。
   */
  text: string;
  /**
   * 当前回复阶段。
   */
  phase: "step" | "final" | "error";
  /**
   * 当前分发模式。
   */
  mode: "direct" | "fallback";
  /**
   * 本次发送是否成功。
   */
  success: boolean;
  /**
   * 错误信息。
   */
  error?: string;
}

/**
 * chat 入队前管道输入。
 */
export interface ChatEnqueuePipelineInput {
  /**
   * 入队类型。
   */
  kind: "exec" | "audit";
  /**
   * 当前消息来源渠道。
   */
  channel: ChatDispatchChannel;
  /**
   * 当前 lane / context 键。
   */
  chat_key: string;
  /**
   * 目标会话 ID。
   */
  chatId: string;
  /**
   * 当前消息文本。
   */
  text: string;
  /**
   * 会话类型。
   */
  chatType?: string;
  /**
   * 线程 ID。
   */
  threadId?: number;
  /**
   * 消息 ID。
   */
  message_id?: string;
  /**
   * 发送者 ID。
   */
  actorId?: string;
  /**
   * 发送者名称。
   */
  actorName?: string;
  /**
   * 附加元信息。
   */
  extra?: Record<string, unknown>;
}

/**
 * chat 入队后事件输入。
 */
export interface ChatEnqueueEffectInput extends ChatEnqueuePipelineInput {
  /**
   * 队列项 ID。
   */
  itemId: string;
  /**
   * 当前 lane 排队位置。
   */
  lanePosition: number;
}
