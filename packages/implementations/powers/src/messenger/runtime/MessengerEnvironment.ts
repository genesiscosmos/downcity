/**
 * MessengerEnvironment：messenger 运行时环境事实的解析与渲染。
 *
 * 关键点（中文）
 * - 环境事实随本轮 user message 一起进入 Session，不再写入 system prompt。
 * - 同一份解析逻辑服务两件事：为当前执行选择 channel prompt、为入站消息构造 context part。
 * - 只读取 Session origin 与 Conversation 的路由元信息，不承载用户身份字段。
 */

import type { StepSnapshot } from "@downcity/city/power";
import type { MessengerConversationRecord } from "@/messenger/types/MessengerReliability.js";
import type { MessengerEnvironmentPromptInput } from "@/messenger/types/MessengerPromptContext.js";

/** Conversation 中参与环境构造的字段。 */
type MessengerEnvironmentSource = Pick<
  MessengerConversationRecord,
  "session_id" | "external_chat_id" | "chat_type" | "thread_id" | "title"
>;

/** 校验并归一化平台类型。 */
export function normalize_messenger_channel(
  value: unknown,
): MessengerEnvironmentPromptInput["channel"] | null {
  const channel = String(value ?? "").trim();
  if (channel === "telegram" || channel === "feishu") return channel;
  return null;
}

/**
 * 从当前执行上下文解析本轮 channel。
 *
 * 说明（中文）
 * - 仅供选择 platform prompt 使用；环境事实本身随消息持久化。
 * - 仅 Channel Session 使用平台提示词，并要求来源中包含外部 chat_id 与有效平台。
 */
export function resolve_current_messenger_channel(
  execution_context?: StepSnapshot,
): MessengerEnvironmentPromptInput["channel"] | null {
  const origin = execution_context?.session_origin;
  if (origin?.type !== "channel") return null;
  if (!String(execution_context?.session_id || "").trim()) return null;
  if (!String(origin.chat_id || "").trim()) return null;
  return normalize_messenger_channel(origin.channel);
}

/**
 * 从 Conversation 记录构造本轮 messenger 环境输入。
 */
export function build_messenger_environment_input(params: {
  /** 当前 in-flight Conversation 记录。 */
  conversation: MessengerEnvironmentSource;
  /** 当前 Bot Account 的平台类型。 */
  channel: MessengerEnvironmentPromptInput["channel"];
}): MessengerEnvironmentPromptInput {
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
 * 渲染 messenger 环境 context part 正文。
 *
 * 说明（中文）
 * - 只输出 `key: value` 事实行。
 * - 不重复 `# Current Messenger Environment` 标题：「环境事实」的语义由 tag 表达，
 *   而「这些字段不是用户身份」由 messenger power prompt 统一解释。
 */
export function render_messenger_environment_body(
  input: MessengerEnvironmentPromptInput,
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
