/**
 * MessengerPowerSystem：messenger power 的 system prompt 组装模块。
 *
 * 关键点（中文）
 * - messenger power prompt 与 channel prompt 都属于静态资产，不会被会话压缩影响。
 * - 当前请求只注入当前 messenger platform 的 prompt，避免平台规则串味。
 * - 本轮 messenger 路由环境属于 per-message 事实，走 user message context part，
 *   不在这里注入，避免同一事实出现两份来源。
 * - 该模块只负责 prompt 解析与拼装，不承担运行态控制职责。
 */
import type { MessengerProvider } from "@/messenger/types/MessengerAccount.js";
import {
  MESSENGER_POWER_PROMPT,
  FEISHU_MESSENGER_CHANNEL_PROMPT,
  TELEGRAM_MESSENGER_CHANNEL_PROMPT,
} from "@/messenger/runtime/MessengerPromptAssets.js";

const MESSENGER_CHANNEL_PROMPTS: Record<"telegram" | "feishu", string> = {
  telegram: TELEGRAM_MESSENGER_CHANNEL_PROMPT,
  feishu: FEISHU_MESSENGER_CHANNEL_PROMPT,
};

/**
 * 构建 messenger power 注入到 session 的 system 文本。
 */
export function buildMessengerPowerSystem(
  channel?: MessengerProvider,
): string {
  return [MESSENGER_POWER_PROMPT, channel ? MESSENGER_CHANNEL_PROMPTS[channel] : undefined]
    .filter(Boolean)
    .join("\n\n");
}
