/**
 * Chat SystemPrompt：chat 运行时 system prompt 辅助。
 *
 * 关键点（中文）
 * - 把当前 chat 路由环境从入站 `<info>` 中剥离，改由 system prompt 注入。
 * - 仅描述当前会话环境，不承载用户身份字段。
 * - 统一从 request context + ChatMetaStore 读取当前 chat 元信息。
 */

import type { PluginContext } from "@downcity/agent";
import type { PluginRunContext } from "@downcity/agent";
import type { ChatEnvironmentPromptInput } from "@/chat/types/ChatPromptContext.js";
import { readChatMetaBySessionId } from "@/chat/runtime/ChatMetaStore.js";

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
  run_context?: PluginRunContext,
): Promise<ChatEnvironmentPromptInput | null> {
  const session_id = String(run_context?.session_id || "").trim();
  if (!session_id) return null;

  const meta = await readChatMetaBySessionId({
    context,
    session_id,
  }).catch(() => null);
  if (!meta?.channel || !meta.chatId) return null;

  return {
    session_id: meta.session_id,
    chat_key: meta.session_id,
    channel: meta.channel,
    chatId: meta.chatId,
    ...(meta.targetType ? { chatType: meta.targetType } : {}),
    ...(typeof meta.threadId === "number" ? { threadId: meta.threadId } : {}),
    ...(meta.chatTitle ? { chatTitle: meta.chatTitle } : {}),
  };
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
    `- chat_id: ${normalizePromptValue(input.chatId, "unknown")}`,
    `- chat_type: ${normalizePromptValue(input.chatType, "unknown")}`,
    `- thread_id: ${normalizePromptValue(
      typeof input.threadId === "number" ? String(input.threadId) : "",
      "none",
    )}`,
  ];

  const chatTitle = normalizePromptValue(input.chatTitle, "");
  if (chatTitle) {
    lines.push(`- chat_title: ${chatTitle}`);
  }

  return lines.join("\n");
}

/**
 * 读取并渲染当前请求的 chat 环境 prompt。
 */
export async function buildCurrentChatEnvironmentPrompt(
  context: PluginContext,
  run_context?: PluginRunContext,
): Promise<string> {
  const input = await resolveCurrentChatEnvironmentPromptInput(
    context,
    run_context,
  );
  if (!input) return "";
  return buildChatEnvironmentPrompt(input);
}
