/**
 * ChatChannelConfig：chat 渠道配置与状态快照模块。
 *
 * 关键点（中文）
 * - 渠道配置摘要与状态快照统一收敛在这里。
 * - Plugin 只读取宿主构造时传入的 channel 配置，不负责修改或持久化。
 */

import type { JsonObject } from "@downcity/agent";
import type { AgentContext } from "@downcity/agent";
import type { StoredChannelAccount } from "@/chat/types/ChannelAccountStore.js";
import type {
  ChatChannelName,
  ChatChannelStateSnapshot,
} from "@/chat/types/ChannelStatus.js";
import type { ChatChannelState } from "@/chat/types/ChatRuntime.js";
import { getChatChannelConfiguration } from "@/chat/channels/ConfigurationRegistry.js";
import {
  getChatChannelBot,
  isChatChannelEnabled,
  isChannelAccountConfigured,
  resolveChannelAccount,
  resolveChannelAccountId,
} from "./ChatChannelCore.js";

function toJsonObject(input: unknown): JsonObject {
  return JSON.parse(JSON.stringify(input)) as JsonObject;
}

/**
 * 生成可安全暴露给 UI 的渠道配置摘要。
 *
 * 关键点（中文）
 * - 不返回明文密钥，只返回布尔“是否已配置”。
 * - 字段命名与 Agent 全局配置保持一致，便于前端直接映射编辑。
 */
export function buildChatChannelConfigSummary(
  context: AgentContext,
  channel: ChatChannelName,
  accountInput?: StoredChannelAccount | null,
): Record<string, string | number | boolean | null> {
  const account = accountInput ?? resolveChannelAccount(context, channel);
  const channelAccountId = resolveChannelAccountId(context, channel);
  const configured = isChannelAccountConfigured(channel, account);
  if (channel === "telegram") {
    return {
      enabled: isChatChannelEnabled(context, channel),
      channelAccountId: channelAccountId || null,
      channelAccountConfigured: configured,
    };
  }
  if (channel === "feishu") {
    return {
      enabled: isChatChannelEnabled(context, channel),
      channelAccountId: channelAccountId || null,
      channelAccountConfigured: configured,
    };
  }
  return {
    enabled: isChatChannelEnabled(context, channel),
    channelAccountId: channelAccountId || null,
    channelAccountConfigured: configured,
  };
}

/**
 * 读取单个渠道状态快照。
 */
export function getChatChannelStatus(
  state: ChatChannelState,
  context: AgentContext,
  channel: ChatChannelName,
): ChatChannelStateSnapshot {
  const enabled = isChatChannelEnabled(context, channel);
  const channelAccount = resolveChannelAccount(context, channel);
  const configured = isChannelAccountConfigured(channel, channelAccount);

  const runtime = getChatChannelBot(state, channel)?.getExecutorStatus();
  const linkState = !enabled
    ? "disconnected"
    : !configured
      ? "disconnected"
      : runtime?.linkState || "unknown";
  const statusText = !enabled
    ? "disabled"
    : !configured
      ? "config_missing"
      : runtime?.statusText || "not_started";

  return {
    channel,
    enabled,
    configured,
    running: runtime?.running === true,
    linkState,
    statusText,
    detail: {
      ...(runtime?.detail || {}),
      config: buildChatChannelConfigSummary(context, channel, channelAccount),
      configuration: toJsonObject(getChatChannelConfiguration(channel).describe()),
    },
  };
}
