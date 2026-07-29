/**
 * ChatChannelConfig：chat 渠道配置与状态快照模块。
 *
 * 关键点（中文）
 * - 渠道配置摘要与状态快照统一收敛在这里。
 * - Plugin 只读取宿主构造时传入的 channel 配置，不负责修改或持久化。
 */

import type { JsonObject } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type { ChatRuntimeAccount } from "@/chat/types/ChatRuntimeAccount.js";
import type {
  ChatChannelName,
  ChatChannelStateSnapshot,
} from "@/chat/types/ChannelStatus.js";
import type { ChatChannelState } from "@/chat/types/ChatRuntime.js";
import { get_chat_plugin_resource_json_schema } from "@/chat/config/ChatPluginConfig.js";
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
  context: PluginContext,
  channel: ChatChannelName,
  accountInput?: ChatRuntimeAccount | null,
): Record<string, string | number | boolean | null> {
  const account = accountInput ?? resolveChannelAccount(context, channel);
  const resource_id = resolveChannelAccountId(context, channel);
  const configured = isChannelAccountConfigured(channel, account);
  if (channel === "telegram") {
    return {
      enabled: isChatChannelEnabled(context, channel),
      resource_id: resource_id || null,
      resource_configured: configured,
    };
  }
  if (channel === "feishu") {
    return {
      enabled: isChatChannelEnabled(context, channel),
      resource_id: resource_id || null,
      resource_configured: configured,
    };
  }
  return {
    enabled: isChatChannelEnabled(context, channel),
    resource_id: resource_id || null,
    resource_configured: configured,
  };
}

/**
 * 读取单个渠道状态快照。
 */
export function getChatChannelStatus(
  state: ChatChannelState,
  context: PluginContext,
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
      resource_schema: toJsonObject(get_chat_plugin_resource_json_schema(channel)),
    },
  };
}
