/**
 * Feishu 渠道配置描述。
 *
 * 关键点（中文）
 * - ship 层只保留绑定字段。
 * - appId/appSecret/domain 由 chat account 维护。
 */

import { ChatChannelConfiguration } from "@/chat/channels/Configuration.js";
import type { ChatChannelConfigurationDescriptor } from "@/chat/types/ChannelConfiguration.js";

/**
 * Feishu 渠道配置描述器。
 */
export class FeishuChannelConfiguration extends ChatChannelConfiguration {
  readonly channel = "feishu" as const;

  describe(): ChatChannelConfigurationDescriptor {
    return {
      channel: this.channel,
      title: "Feishu Chat Platform Configuration",
      description:
        "Bind a Feishu/Lark chat account and control runtime enable/disable state.",
      version: "1.0.0",
      capabilities: {
        canToggleEnabled: true,
        canBindChannelAccount: true,
        canConfigure: true,
      },
      fields: {
        agent_config: [
          {
            key: "enabled",
            label: "Enabled",
            description:
              "Whether feishu channel should be started by runtime.",
            type: "boolean",
            source: "agent_config",
            required: false,
            nullable: false,
            writable: true,
            restartRequired: true,
            default_value: false,
            example: true,
          },
          {
            key: "channelAccountId",
            label: "Chat Account ID",
            description:
              "Bind this chat platform to a channel_accounts row in the global downcity.db.",
            type: "string",
            source: "agent_config",
            required: false,
            nullable: true,
            writable: true,
            restartRequired: true,
            example: "feishu-main",
          },
        ],
        channelAccount: [],
        envFallback: [],
      },
    };
  }
}
