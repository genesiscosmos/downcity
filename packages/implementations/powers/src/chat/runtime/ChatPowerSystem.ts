/**
 * ChatPowerSystem：chat power 的 system prompt 组装模块。
 *
 * 关键点（中文）
 * - chat power prompt 与 channel prompt 都属于静态资产，不会被会话压缩影响。
 * - 当前请求只注入当前 chat platform 的 prompt，避免平台规则串味。
 * - 本轮 chat 路由环境属于 per-message 事实，走 user message context part，
 *   不在这里注入，避免同一事实出现两份来源。
 * - 该模块只负责 prompt 解析与拼装，不承担运行态控制职责。
 */
import type { StepSnapshot } from "@downcity/city/power";
import { resolve_current_chat_channel } from "@/chat/runtime/ChatEnvironment.js";
import {
  CHAT_POWER_PROMPT,
  FEISHU_CHAT_CHANNEL_PROMPT,
  TELEGRAM_CHAT_CHANNEL_PROMPT,
} from "@/chat/runtime/ChatPromptAssets.js";

const CHAT_CHANNEL_PROMPTS: Record<"telegram" | "feishu", string> = {
  telegram: TELEGRAM_CHAT_CHANNEL_PROMPT,
  feishu: FEISHU_CHAT_CHANNEL_PROMPT,
};

/**
 * 构建当前请求所属 channel 的提示词片段。
 *
 * 关键点（中文）
 * - 仅注入当前 context 对应的 channel prompt，避免把其他平台规则混入本轮会话。
 * - 若当前 context 不是 chat platform（如 Console UI）或尚无路由元信息，则不注入 platform prompt。
 */
export function buildCurrentChannelPrompts(
  execution_context?: StepSnapshot,
): string[] {
  const channel = resolve_current_chat_channel(execution_context);
  if (!channel) return [];
  return [CHAT_CHANNEL_PROMPTS[channel]].filter(Boolean);
}

/**
 * 构建 chat power 注入到 session 的 system 文本。
 */
export function buildChatPowerSystem(
  execution_context?: StepSnapshot,
): string {
  return [CHAT_POWER_PROMPT, ...buildCurrentChannelPrompts(execution_context)]
    .filter(Boolean)
    .join("\n\n");
}
