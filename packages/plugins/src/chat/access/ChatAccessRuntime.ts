/**
 * Chat Access Runtime 装配辅助。
 *
 * 关键点（中文）
 * - 从当前 ChatPlugin channel 配置解析稳定 issuer。
 * - Channel Adapter、Plugin Action 和 CLI 共享同一个 Service 构造规则。
 */

import type { PluginContext } from "@downcity/agent";
import { ChatAccessService } from "@/chat/access/ChatAccessService.js";
import { resolveChannelAccount } from "@/chat/runtime/ChatChannelCore.js";
import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";

const CHANNELS: ChatDispatchChannel[] = ["telegram", "feishu", "qq"];

/** 解析当前 Agent 各渠道的稳定 Issuer。 */
export function resolve_chat_access_issuer_map(
  context: PluginContext,
): Partial<Record<ChatDispatchChannel, string>> {
  const issuer_by_channel: Partial<Record<ChatDispatchChannel, string>> = {};
  for (const channel of CHANNELS) {
    const issuer = String(resolveChannelAccount(context, channel)?.id || "").trim();
    if (issuer) issuer_by_channel[channel] = issuer;
  }
  return issuer_by_channel;
}

/** 创建当前 Agent 的 ChatAccessService。 */
export function create_chat_access_service(context: PluginContext): ChatAccessService {
  return new ChatAccessService({
    data_path: context.data_path,
  });
}

/** 解析指定渠道当前稳定 Issuer。 */
export function resolve_chat_access_issuer(
  context: PluginContext,
  channel: ChatDispatchChannel,
): string {
  return String(resolve_chat_access_issuer_map(context)[channel] || "").trim();
}
