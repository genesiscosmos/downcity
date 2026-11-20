/**
 * MessengerEnvironment：messenger 运行时环境事实的解析与渲染。
 *
 * 关键点（中文）
 * - 环境事实随本轮 user message 一起进入 Session，不再写入 system prompt。
 * - 从 Conversation 的路由元信息构造入站 context part，正文不包含用户身份字段。
 */

import type { MessengerConversationRecord } from "@/messenger/types/MessengerReliability.js";
import type { MessengerEnvironmentPromptInput } from "@/messenger/types/MessengerPromptContext.js";

/** Conversation 中参与环境构造的字段。 */
type MessengerEnvironmentSource = Pick<
  MessengerConversationRecord,
  "session_id" | "external_chat_id" | "chat_type" | "thread_id" | "title"
>;

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
