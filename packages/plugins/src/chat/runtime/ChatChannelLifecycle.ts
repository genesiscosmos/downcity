/**
 * ChatChannelLifecycle：chat 渠道生命周期模块。
 *
 * 关键点（中文）
 * - 渠道 bot 的创建、启动、停止逻辑统一收敛在这里。
 * - 渠道 bot 状态归属于 chat plugin runtime 实例持有的 `ChatChannelState`。
 * - 本模块不处理配置持久化，也不负责 action 输入输出包装。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatChannelState } from "@/chat/types/ChatRuntime.js";
import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";
import { createTelegramBot } from "@/chat/channels/telegram/Bot.js";
import { createQQBot } from "@/chat/channels/qq/QQ.js";
import {
  isChatChannelEnabled,
  resolveChannelAccount,
  resolveTargetChannels,
} from "./ChatChannelCore.js";

/**
 * 延迟创建 Feishu bot。
 *
 * 关键点（中文）
 * - Feishu 依赖 `@larksuiteoapi/node-sdk`，由启用 Feishu 的宿主应用显式安装。
 * - 只有 Feishu channel 实际启用且凭据完整时，才加载 Feishu runtime 模块。
 */
async function createFeishuBotLazy(
  options: {
    /**
     * 是否启用。
     */
    enabled: boolean;
    /**
     * Feishu / Lark App ID。
     */
    appId: string;
    /**
     * Feishu / Lark App Secret。
     */
    appSecret: string;
    /**
     * Feishu / Lark Open API 域名。
     */
    domain: string;
  },
  context: PluginContext,
) {
  const module_value = await import("@/chat/channels/feishu/Feishu.js");
  return await module_value.createFeishuBot(options, context);
}

async function startTelegramChannel(
  state: ChatChannelState,
  context: PluginContext,
): Promise<void> {
  if (!isChatChannelEnabled(context, "telegram")) return;
  context.logger.info("Telegram channel enabled");
  const account = resolveChannelAccount(context, "telegram");
  const token = String(account?.botToken || "").trim();
  if (!token) return;
  state.telegram = createTelegramBot(
    {
      enabled: true,
      botToken: token,
    },
    context,
  );
  if (state.telegram) {
    await state.telegram.start();
  }
}

async function startFeishuChannel(
  state: ChatChannelState,
  context: PluginContext,
): Promise<void> {
  if (!isChatChannelEnabled(context, "feishu")) return;
  context.logger.info("Feishu channel enabled");
  const account = resolveChannelAccount(context, "feishu");
  const appId = String(account?.appId || "").trim();
  const appSecret = String(account?.appSecret || "").trim();
  if (!appId || !appSecret) return;
  state.feishu = await createFeishuBotLazy(
    {
      enabled: true,
      appId,
      appSecret,
      domain: String(account?.domain || "").trim() || "https://open.feishu.cn",
    },
    context,
  );
  if (state.feishu) {
    await state.feishu.start();
  }
}

async function startQQChannel(
  state: ChatChannelState,
  context: PluginContext,
): Promise<void> {
  if (!isChatChannelEnabled(context, "qq")) return;
  context.logger.info("QQ chat platform enabled");
  const account = resolveChannelAccount(context, "qq");
  const appId = String(account?.appId || "").trim();
  const appSecret = String(account?.appSecret || "").trim();
  if (!appId || !appSecret) return;
  state.qq = await createQQBot(
    {
      enabled: true,
      appId,
      appSecret,
      sandbox: account?.sandbox === true,
    },
    context,
  );
  if (state.qq) {
    await state.qq.start();
  }
}

/**
 * 启动单个渠道。
 */
export async function startSingleChatChannel(
  state: ChatChannelState,
  context: PluginContext,
  channel: ChatChannelName,
): Promise<void> {
  if (channel === "telegram") {
    await startTelegramChannel(state, context);
    return;
  }
  if (channel === "feishu") {
    await startFeishuChannel(state, context);
    return;
  }
  await startQQChannel(state, context);
}

/**
 * 停止单个渠道。
 */
export async function stopSingleChatChannel(
  state: ChatChannelState,
  channel: ChatChannelName,
): Promise<void> {
  if (channel === "telegram" && state.telegram) {
    const bot = state.telegram;
    state.telegram = null;
    await bot.stop();
    return;
  }
  if (channel === "feishu" && state.feishu) {
    const bot = state.feishu;
    state.feishu = null;
    await bot.stop();
    return;
  }
  if (channel === "qq" && state.qq) {
    const bot = state.qq;
    state.qq = null;
    await bot.stop();
  }
}

/**
 * 启动全部已启用的 chat 渠道。
 */
export async function startChatChannels(
  state: ChatChannelState,
  context: PluginContext,
): Promise<void> {
  if (state.telegram || state.feishu || state.qq) {
    await stopChatChannels(state);
  }
  for (const channel of resolveTargetChannels()) {
    await startSingleChatChannel(state, context, channel);
  }
}

/**
 * 停止全部 chat 渠道。
 */
export async function stopChatChannels(state: ChatChannelState): Promise<void> {
  const current = { ...state };
  state.telegram = null;
  state.feishu = null;
  state.qq = null;

  if (current.telegram) {
    await current.telegram.stop();
  }
  if (current.feishu) {
    await current.feishu.stop();
  }
  if (current.qq) {
    await current.qq.stop();
  }
}
