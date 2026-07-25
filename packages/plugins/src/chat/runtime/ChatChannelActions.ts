/**
 * ChatChannelActions：chat 渠道 action 执行模块。
 *
 * 关键点（中文）
 * - status/test/reconnect 的执行逻辑统一收敛在这里。
 * - 该模块复用 lifecycle/config 模块，不直接持有长期运行态。
 * - 对外只暴露 action 级入口，供 ChatPluginActions 装配使用。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatChannelState } from "@/chat/types/ChatRuntime.js";
import type {
  ChatReconnectActionPayload,
  ChatStatusActionPayload,
  ChatTestActionPayload,
} from "@/chat/types/ChatPluginActionPayload.js";
import type { ChatChannelTestResult } from "@/chat/types/ChannelStatus.js";
import { getChatChannelStatus } from "./ChatChannelConfig.js";
import {
  getChatChannelBot,
  resolveTargetChannels,
} from "./ChatChannelCore.js";
import {
  startSingleChatChannel,
  stopSingleChatChannel,
} from "./ChatChannelLifecycle.js";

/**
 * 执行 `chat.status` action。
 */
export async function executeChatStatusAction(params: {
  state: ChatChannelState;
  context: PluginContext;
  payload: ChatStatusActionPayload;
}) {
  const channels = resolveTargetChannels(params.payload.channel);
  const items = channels.map((channel) =>
    getChatChannelStatus(params.state, params.context, channel),
  );
  return {
    success: true,
    data: {
      channels: items,
    },
  };
}

/**
 * 执行 `chat.test` action。
 */
export async function executeChatTestAction(params: {
  state: ChatChannelState;
  context: PluginContext;
  payload: ChatTestActionPayload;
}) {
  const channels = resolveTargetChannels(params.payload.channel);
  const results: ChatChannelTestResult[] = [];
  for (const channel of channels) {
    const snapshot = getChatChannelStatus(params.state, params.context, channel);
    if (!snapshot.enabled) {
      results.push({
        channel,
        success: false,
        testedAtMs: Date.now(),
        message: "Channel is disabled",
      });
      continue;
    }
    if (!snapshot.configured) {
      results.push({
        channel,
        success: false,
        testedAtMs: Date.now(),
        message: "Channel credentials are missing",
      });
      continue;
    }

    const bot = getChatChannelBot(params.state, channel);
    if (!bot) {
      results.push({
        channel,
        success: false,
        testedAtMs: Date.now(),
        message: "Channel is not running. Use reconnect first.",
      });
      continue;
    }
    results.push(await bot.testConnection());
  }

  return {
    success: true,
    data: {
      results,
      total: results.length,
      failed: results.filter((item) => !item.success).length,
    },
  };
}

/**
 * 执行 `chat.reconnect` action。
 */
export async function executeChatReconnectAction(params: {
  state: ChatChannelState;
  context: PluginContext;
  payload: ChatReconnectActionPayload;
}) {
  const targets = resolveTargetChannels(params.payload.channel);
  for (const channel of targets) {
    const snapshot = getChatChannelStatus(params.state, params.context, channel);
    if (!snapshot.enabled) {
      return {
        success: false,
        error: `Channel ${channel} is disabled`,
      };
    }
    if (!snapshot.configured) {
      return {
        success: false,
        error: `Channel ${channel} credentials are missing`,
      };
    }
  }

  for (const channel of targets) {
    await stopSingleChatChannel(params.state, channel);
  }
  for (const channel of targets) {
    await startSingleChatChannel(params.state, params.context, channel);
  }

  const channels = targets.map((channel) =>
    getChatChannelStatus(params.state, params.context, channel),
  );
  return {
    success: true,
    data: {
      channels,
    },
  };
}
