/**
 * Chat reply dispatch helper。
 *
 * 关键点（中文）
 * - 把 chat 回复前/回复后的扩展点统一收敛到这里。
 * - 仅服务 agent 执行生命周期，不覆盖手动 `chat send`。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatReplyDispatchInput, ChatReplyEffectInput } from "@/chat/types/ChatPlugin.js";
import type { JsonValue } from "@downcity/agent";
import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";
import { CHAT_PLUGIN_POINTS } from "@/chat/runtime/PluginPoints.js";
import { resolveDispatchTargetByChatKey } from "@/chat/runtime/ChatkeySend.js";

function normalizeText(value: string | undefined): string {
  return String(value || "").trim();
}

/**
 * 回复前文本增强。
 */
export async function prepareChatReplyText(params: {
  context: PluginContext;
  input: ChatReplyDispatchInput;
}): Promise<string> {
  const input = {
    ...params.input,
    text: normalizeText(params.input.text),
  };
  if (!input.text) return "";

  const next = await params.context.plugins.pipeline<JsonValue>(
    CHAT_PLUGIN_POINTS.beforeReply,
    input as unknown as JsonValue,
  );
  const record =
    next && typeof next === "object" && !Array.isArray(next)
      ? (next as Record<string, unknown>)
      : {};
  return normalizeText(typeof record.text === "string" ? record.text : input.text);
}

/**
 * 回复后事件分发。
 */
export async function emitChatReplyEffect(params: {
  context: PluginContext;
  input: ChatReplyEffectInput;
}): Promise<void> {
  await params.context.plugins.effect(
    CHAT_PLUGIN_POINTS.afterReply,
    params.input as unknown as JsonValue,
  );
}

/**
 * 基于 chat_key 补齐回复目标上下文。
 */
export async function resolveChatReplyTarget(params: {
  context: PluginContext;
  chat_key: string;
}): Promise<{
  channel?: ChatDispatchChannel;
  chatId?: string;
  message_id?: string;
}> {
  const target = await resolveDispatchTargetByChatKey({
    context: params.context,
    chat_key: params.chat_key,
  });
  if (!target) return {};
  return {
    channel: target.channel,
    chatId: target.chatId,
    ...(target.message_id ? { message_id: target.message_id } : {}),
  };
}
