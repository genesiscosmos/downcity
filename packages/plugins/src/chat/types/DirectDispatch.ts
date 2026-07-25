/**
 * Direct dispatch 协议类型。
 *
 * 关键点（中文）
 * - 仅用于当前 chat assistant 出站解析。
 * - frontmatter metadata 语义与 `downcity chat send` 保持一致，再额外支持 `react`。
 */

import type {
  ChatMessageFileTag,
  ChatMessageFileType,
} from "@downcity/agent";

export type DirectFileType = ChatMessageFileType;
export type DirectFileTagPayload = ChatMessageFileTag;

/**
 * 解析后的反应参数（来自 frontmatter metadata）。
 */
export interface DirectReactTagPayload {
  /**
   * 表情内容（如 👍 / 🔥）。
   *
   * 说明（中文）
   * - 不能为空字符串。
   */
  emoji: string;

  /**
   * 是否使用大表情。
   *
   * 说明（中文）
   * - 仅平台支持时生效（如 Telegram）。
   */
  big?: boolean;
}

/**
 * 运行时主文本发送参数（可直接用于发送）。
 */
export interface ResolvedDirectTextPayload {
  /**
   * 用户可见正文（已 trim，非空）。
   */
  text: string;

  /**
   * 最终目标会话键（已回填默认值）。
   */
  chat_key: string;

  /**
   * 是否以 reply 语义发送正文。
   *
 * 说明（中文）
 * - 语义与 `downcity chat send --reply` 一致。
 * - 当 metadata 提供 `reply: true` 或显式 `message_id` 时自动为 true。
  */
  reply_to_message: boolean;

  /**
   * 可选 reply 目标消息 ID。
   *
   * 说明（中文）
   * - 来自 metadata 的 `message_id`，或 `reply` 的旧式 message_id 写法。
   */
  message_id?: string;

  /**
   * 可选延迟发送毫秒数。
   *
   * 说明（中文）
   * - 与 `downcity chat send --delay` 对齐。
   */
  delay_ms?: number;

  /**
   * 可选定时发送毫秒时间戳。
   *
   * 说明（中文）
   * - 与 `downcity chat send --time` 对齐。
   */
  send_at_ms?: number;
}

/**
 * 运行时反应发送参数（可直接用于发送）。
 */
export interface ResolvedDirectReactionPayload {
  /**
   * 表情内容（已 trim，非空）。
   */
  emoji: string;

  /**
   * 最终目标会话键（已回填默认值）。
   */
  chat_key: string;

  /**
   * 可选目标消息 ID。
   *
   * 说明（中文）
   * - 来自主文本 metadata 的 `reply`。
   */
  message_id?: string;

  /**
   * 是否使用大表情。
   */
  big: boolean;
}

/**
 * direct 模式一次 assistant 输出的完整执行计划。
 */
export interface ResolvedDirectDispatchPlan {
  /**
   * 主文本发送计划。
   *
   * 说明（中文）
   * - 为空表示本轮没有可发送正文（例如只有 reaction metadata）。
   */
  text: ResolvedDirectTextPayload | null;

  /**
   * 反应动作计划列表。
   *
   * 说明（中文）
   * - 允许一次输出触发多个反应动作。
   */
  reactions: ResolvedDirectReactionPayload[];
}
