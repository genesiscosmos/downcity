/**
 * ChatEnvironment：chat 运行时环境事实的解析与渲染。
 *
 * 关键点（中文）
 * - 环境事实随本轮 user message 一起进入 Session，不再写入 system prompt。
 * - 同一份解析逻辑服务两件事：为当前执行选择 channel prompt、为入站消息构造 context part。
 * - 只读取 Session origin 与 Conversation 的路由元信息，不承载用户身份字段。
 */

import type { PowerExecutionContext } from "@downcity/city/power";
import type { ChatConversationRecord } from "@/chat/types/ChatReliability.js";
import type { ChatEnvironmentPromptInput } from "@/chat/types/ChatPromptContext.js";

/** Conversation 中参与环境构造的字段。 */
type ChatEnvironmentSource = Pick<
  ChatConversationRecord,
  "session_id" | "external_chat_id" | "chat_type" | "thread_id" | "title"
>;

/** 校验并归一化平台类型。 */
export function normalize_chat_channel(
  value: unknown,
): ChatEnvironmentPromptInput["channel"] | null {
  const channel = String(value ?? "").trim();
  if (channel === "telegram" || channel === "feishu") return channel;
  return null;
}

/**
 * 从当前执行上下文解析本轮 channel。
 *
 * 说明（中文）
 * - 仅供选择 platform prompt 使用；环境事实本身随消息持久化。
 * - 非 chat session、尚无 route、或操作者不是 chat 平台时返回 `null`。
 */
export function resolve_current_chat_channel(
  execution_context?: PowerExecutionContext,
): ChatEnvironmentPromptInput["channel"] | null {
  const origin = execution_context?.session_origin;
  if (origin?.type !== "chat") return null;
  if (!String(execution_context?.session_id || "").trim()) return null;
  if (!String(origin.chat_id || "").trim()) return null;
  return normalize_chat_channel(origin.channel);
}

/**
 * 从 Conversation 记录构造本轮 chat 环境输入。
 */
export function build_chat_environment_input(params: {
  /** 当前 in-flight Conversation 记录。 */
  conversation: ChatEnvironmentSource;
  /** 当前 Bot Account 的平台类型。 */
  channel: ChatEnvironmentPromptInput["channel"];
}): ChatEnvironmentPromptInput {
  const thread_id = Number(params.conversation.thread_id);
  return {
    session_id: params.conversation.session_id,
    channel: params.channel,
    chat_id: params.conversation.external_chat_id,
    ...(params.conversation.chat_type
      ? { chat_type: params.conversation.chat_type }
      : {}),
    ...(Number.isFinite(thread_id) ? { thread_id } : {}),
    ...(params.conversation.title ? { chat_title: params.conversation.title } : {}),
  };
}

/**
 * 渲染 chat 环境 context part 正文。
 *
 * 说明（中文）
 * - 只输出 `key: value` 事实行。
 * - 不重复 `# Current Chat Environment` 标题：「环境事实」的语义由 tag 表达，
 *   而「这些字段不是用户身份」由 chat power prompt 统一解释。
 */
export function render_chat_environment_body(
  input: ChatEnvironmentPromptInput,
): string {
  const lines = [
    `channel: ${input.channel}`,
    `session_id: ${input.session_id}`,
    `chat_id: ${input.chat_id}`,
    `chat_type: ${input.chat_type || "unknown"}`,
    `thread_id: ${typeof input.thread_id === "number" ? String(input.thread_id) : "none"}`,
  ];
  if (input.chat_title) lines.push(`chat_title: ${input.chat_title}`);
  return lines.join("\n");
}
