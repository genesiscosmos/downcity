/**
 * Chat enqueue dispatch helper。
 *
 * 关键点（中文）
 * - 统一封装入队前/后的扩展点调用。
 * - service 通过这里暴露 queue 生命周期，不直接散落调用细节。
 */

import type { PluginContext } from "@downcity/agent";
import type {
  ChatEnqueueEffectInput,
  ChatEnqueuePipelineInput,
} from "@/chat/types/ChatPlugin.js";
import type { JsonValue } from "@downcity/agent";
import { CHAT_PLUGIN_POINTS } from "@/chat/runtime/PluginPoints.js";

function normalizeText(value: string): string {
  return String(value || "").trim();
}

/**
 * 入队前增强。
 */
export async function prepareChatEnqueue(params: {
  context: PluginContext;
  input: ChatEnqueuePipelineInput;
}): Promise<ChatEnqueuePipelineInput> {
  const normalized: ChatEnqueuePipelineInput = {
    ...params.input,
    text: normalizeText(params.input.text),
  };
  return (params.context.plugins.pipeline<JsonValue>(
    CHAT_PLUGIN_POINTS.beforeEnqueue,
    normalized as unknown as JsonValue,
  ) as unknown) as Promise<ChatEnqueuePipelineInput>;
}

/**
 * 入队后通知。
 */
export async function emitChatEnqueueEffect(params: {
  context: PluginContext;
  input: ChatEnqueueEffectInput;
}): Promise<void> {
  await params.context.plugins.effect(
    CHAT_PLUGIN_POINTS.afterEnqueue,
    params.input as unknown as JsonValue,
  );
}
