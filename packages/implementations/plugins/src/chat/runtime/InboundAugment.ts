/**
 * Chat inbound augment helper。
 *
 * 关键点（中文）
 * - chat plugin runtime 先构造基础输入，再交给 plugin pipeline 做增强。
 * - 最终拼装顺序固定为：attachmentText -> pluginSections -> body_text。
 */

import type { PluginContext } from "@downcity/city/plugin";
import type { ChatInboundAugmentInput } from "@/chat/types/ChatPlugin.js";
import type { PluginJsonValue } from "@downcity/city/plugin";
import { CHAT_PLUGIN_POINTS } from "@/chat/runtime/PluginPoints.js";
import { transcribe_inbound_voice } from "@/chat/runtime/InboundVoiceTranscription.js";

function normalizeText(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  return text || undefined;
}

/** 只执行确定性的入站字段规范化，不调用其他 Plugin。 */
export function normalize_chat_inbound_input(
  input: ChatInboundAugmentInput,
): ChatInboundAugmentInput {
  return {
    ...input,
    ...(input.chatType ? { chatType: input.chatType } : {}),
    ...(input.chat_key ? { chat_key: input.chat_key } : {}),
    ...(input.message_id ? { message_id: input.message_id } : {}),
    ...(normalizeText(input.attachmentText)
      ? { attachmentText: normalizeText(input.attachmentText) }
      : {}),
    ...(normalizeText(input.body_text)
      ? { body_text: normalizeText(input.body_text) }
      : {}),
    pluginSections: Array.isArray(input.pluginSections)
      ? input.pluginSections.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
  };
}

/**
 * 执行 chat 入站增强 pipeline。
 *
 * 关键点（中文）
 * - 先跑插件 pipeline，再叠加入站语音自动转写，保证其他插件看到的仍是不带转写的正文。
 * - 自动转写能力由 City 的 sound capability 提供。
 */
export async function augmentChatInboundInput(params: {
  context: PluginContext;
  input: ChatInboundAugmentInput;
}): Promise<ChatInboundAugmentInput> {
  const normalized = normalize_chat_inbound_input(params.input);

  const augmented = (await (params.context.city.plugins.pipeline<PluginJsonValue>(
    CHAT_PLUGIN_POINTS.augmentInbound,
    normalized as unknown as PluginJsonValue,
  ) as unknown as Promise<ChatInboundAugmentInput>)) as ChatInboundAugmentInput;

  return await transcribe_inbound_voice({
    context: params.context,
    inbound: normalize_chat_inbound_input(augmented),
  });
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
