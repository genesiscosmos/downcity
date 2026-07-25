/**
 * Chat inbound augment helper。
 *
 * 关键点（中文）
 * - chat plugin runtime 先构造基础输入，再交给 plugin pipeline 做增强。
 * - 最终拼装顺序固定为：attachmentText -> pluginSections -> body_text。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatInboundAugmentInput } from "@/chat/types/ChatPlugin.js";
import type { JsonValue } from "@downcity/agent";
import { CHAT_PLUGIN_POINTS } from "@/chat/runtime/PluginPoints.js";

function normalizeText(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  return text || undefined;
}

/**
 * 执行 chat 入站增强 pipeline。
 */
export async function augmentChatInboundInput(params: {
  context: PluginContext;
  input: ChatInboundAugmentInput;
}): Promise<ChatInboundAugmentInput> {
  const normalized: ChatInboundAugmentInput = {
    ...params.input,
    ...(params.input.chatType ? { chatType: params.input.chatType } : {}),
    ...(params.input.chat_key ? { chat_key: params.input.chat_key } : {}),
    ...(params.input.message_id ? { message_id: params.input.message_id } : {}),
    ...(normalizeText(params.input.attachmentText)
      ? { attachmentText: normalizeText(params.input.attachmentText) }
      : {}),
    ...(normalizeText(params.input.body_text)
      ? { body_text: normalizeText(params.input.body_text) }
      : {}),
    pluginSections: Array.isArray(params.input.pluginSections)
      ? params.input.pluginSections.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    attachments: Array.isArray(params.input.attachments) ? params.input.attachments : [],
  };

  return (params.context.plugins.pipeline<JsonValue>(
    CHAT_PLUGIN_POINTS.augmentInbound,
    normalized as unknown as JsonValue,
  ) as unknown) as Promise<ChatInboundAugmentInput>;
}

/**
 * 把增强后的 chat 入站输入拼成最终正文。
 */
export function buildChatInboundText(input: ChatInboundAugmentInput): string {
  return [
    normalizeText(input.attachmentText),
    ...(Array.isArray(input.pluginSections)
      ? input.pluginSections.map((item) => normalizeText(item)).filter(Boolean)
      : []),
    normalizeText(input.body_text),
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
