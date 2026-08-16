/**
 * ChatChannelCore：chat 渠道状态的核心共享辅助模块。
 *
 * 关键点（中文）
 * - 这里只放最基础的渠道状态/名称/account 解析能力。
 * - 生命周期、配置写入、action 执行分别放到更细的模块中。
 * - 目标是让 chat platform 子模块共享同一套最小公共基元。
 */

import type { PluginContext } from "@downcity/agent";
import type { ChatRuntimeAccount } from "@/chat/types/ChatRuntimeAccount.js";
import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";
import type { ChatChannelState } from "@/chat/types/ChatRuntime.js";

const CHAT_CHANNEL_NAMES: ChatChannelName[] = ["telegram", "feishu", "qq"];

export type ChatPluginRuntimeApi = {
  get_channel_id?(context: PluginContext, channel: ChatChannelName): string;
  resolveChannelAccount?(
    context: PluginContext,
    channel: ChatChannelName,
  ): ChatRuntimeAccount | null;
  isChannelEnabled?(context: PluginContext, channel: ChatChannelName): boolean;
};

export function resolveChatPluginRuntimeApi(
  context: PluginContext,
): ChatPluginRuntimeApi | null {
  const candidate = context.plugins.get("chat") as
    | ChatPluginRuntimeApi
    | undefined;
  return candidate || null;
}

/**
 * 创建 chat 渠道状态对象。
 */
export function createChatChannelState(): ChatChannelState {
  return {
    telegram: null,
    feishu: null,
    qq: null,
  };
}

/**
 * 解析并校验渠道名。
 */
export function resolveChatChannelNameOrThrow(value: string): ChatChannelName {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "telegram" ||
    normalized === "feishu" ||
    normalized === "qq"
  ) {
    return normalized;
  }
  throw new Error(`Invalid channel: ${value}. Use telegram|feishu|qq.`);
}

/**
 * 解析目标渠道列表。
 */
export function resolveTargetChannels(channel?: ChatChannelName): ChatChannelName[] {
  return channel ? [channel] : [...CHAT_CHANNEL_NAMES];
}

/**
 * 读取渠道绑定的 bot account id。
 */
export function resolveChannelAccountId(
  context: PluginContext,
  channel: ChatChannelName,
): string {
  const plugin = resolveChatPluginRuntimeApi(context);
  const explicit = String(plugin?.get_channel_id?.(context, channel) || "").trim();
  if (explicit) return explicit;
  return "";
}

/**
 * 解析渠道 account。
 *
 * 关键点（中文）
 * - 账号只通过 ChatPlugin 实例解析，Plugin Core 不访问宿主全局路径或数据库。
 * - 不从项目文件隐式推断运行时账号。
 */
export function resolveChannelAccount(
  context: PluginContext,
  channel: ChatChannelName,
): ChatRuntimeAccount | null {
  const plugin = resolveChatPluginRuntimeApi(context);
  const explicit = plugin?.resolveChannelAccount?.(context, channel);
  return explicit?.channel === channel ? explicit : null;
}

/**
 * 判断渠道 credentials 是否已经配置完整。
 */
export function isChannelAccountConfigured(
  channel: ChatChannelName,
  account: ChatRuntimeAccount | null,
): boolean {
  if (!account) return false;
  if (channel === "telegram") {
    return !!String(account.bot_token || "").trim();
  }
  return !!String(account.app_id || "").trim() && !!String(account.app_secret || "").trim();
}

/**
 * 判断指定渠道当前是否启用。
 */
export function isChatChannelEnabled(
  context: PluginContext,
  channel: ChatChannelName,
): boolean {
  const plugin = resolveChatPluginRuntimeApi(context);
  if (typeof plugin?.isChannelEnabled === "function") {
    return plugin.isChannelEnabled(context, channel);
  }
  return false;
}

/**
 * 读取当前渠道 bot 实例。
 */
export function getChatChannelBot(
  state: ChatChannelState,
  channel: ChatChannelName,
) {
  if (channel === "telegram") return state.telegram;
  if (channel === "feishu") return state.feishu;
  return state.qq;
}
