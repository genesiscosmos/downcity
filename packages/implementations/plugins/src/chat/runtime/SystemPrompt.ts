/**
 * Chat SystemPrompt：chat 运行时 system prompt 辅助。
 *
 * 关键点（中文）
 * - 把当前 chat 路由环境从入站 `<info>` 中剥离，改由 system prompt 注入。
 * - 仅描述当前会话环境，不承载用户身份字段。
 * - 只从 Session origin 读取 Account/Conversation 路由元信息。
 */

import type { PluginContext } from "@downcity/city/plugin";
import type { PluginExecutionContext } from "@downcity/city/plugin";
import type { ChatEnvironmentPromptInput } from "@/chat/types/ChatPromptContext.js";

function normalizePromptValue(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/**
 * 解析当前请求的 chat 环境输入。
 *
 * 说明（中文）
 * - 非 chat session 或尚未建立 chat route 时返回 `null`。
 */
export async function resolveCurrentChatEnvironmentPromptInput(
  context: PluginContext,
  execution_context?: PluginExecutionContext,
): Promise<ChatEnvironmentPromptInput | null> {
  const session_id = String(execution_context?.session_id || "").trim();
  if (!session_id) return null;

  const origin = execution_context?.session_origin;
  const origin_channel = String(origin?.channel || "").trim();
  const origin_chat_id = String(origin?.chat_id || "").trim();
  if (origin?.type === "chat" && origin_channel && origin_chat_id) {
    const channel = resolve_chat_channel(origin_channel);
    if (!channel) return null;
    const thread_value = Number(origin.thread_id);
    return {
      session_id,
      chat_key: session_id,
      channel,
      chat_id: origin_chat_id,
      ...(String(origin.chat_type || "").trim()
        ? { chat_type: String(origin.chat_type).trim() }
        : {}),
      ...(Number.isFinite(thread_value) ? { thread_id: thread_value } : {}),
      ...(String(origin.chat_title || "").trim()
        ? { chat_title: String(origin.chat_title).trim() }
        : {}),
    };
  }
  return null;
}

/** 校验 Session origin 中的平台类型。 */
function resolve_chat_channel(value: string): "telegram" | "feishu" | "qq" | null {
  if (value === "telegram" || value === "feishu" || value === "qq") return value;
  return null;
}

/**
 * 构造当前 chat 环境说明文本。
 */
export function buildChatEnvironmentPrompt(input: ChatEnvironmentPromptInput): string {
  const lines = [
    "# Current Chat Environment",
    "以下字段只描述当前 chat 会话环境与路由，不是用户身份信息：",
    `- channel: ${normalizePromptValue(input.channel, "unknown")}`,
    `- session_id: ${normalizePromptValue(input.session_id, "unknown")}`,
    `- chat_key: ${normalizePromptValue(input.chat_key, "unknown")}`,
    `- chat_id: ${normalizePromptValue(input.chat_id, "unknown")}`,
    `- chat_type: ${normalizePromptValue(input.chat_type, "unknown")}`,
    `- thread_id: ${normalizePromptValue(
      typeof input.thread_id === "number" ? String(input.thread_id) : "",
      "none",
    )}`,
  ];

  const chat_title = normalizePromptValue(input.chat_title, "");
  if (chat_title) {
    lines.push(`- chat_title: ${chat_title}`);
  }

  return lines.join("\n");
}

/**
 * 读取并渲染当前请求的 chat 环境 prompt。
 */
export async function buildCurrentChatEnvironmentPrompt(
  context: PluginContext,
  execution_context?: PluginExecutionContext,
): Promise<string> {
  const input = await resolveCurrentChatEnvironmentPromptInput(
    context,
    execution_context,
  );
  if (!input) return "";
  return buildChatEnvironmentPrompt(input);
}
