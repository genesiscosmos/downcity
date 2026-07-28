/**
 * Chat Plugin 的结构化配置协议。
 *
 * 关键点（中文）
 * - Zod Schema 是内建 Chat 配置的唯一源码。
 * - City 等宿主通过标准 JSON Schema 构建表单与校验 Binding。
 * - 真实账号密钥不进入 Plugin 配置，只保存账号池引用。
 */

import type { JsonObject } from "@downcity/agent";
import { z } from "zod";
import type { ChatChannelName } from "@/chat/types/ChannelStatus.js";

/** 创建单个聊天渠道的 Agent Binding 配置 Schema。 */
function create_chat_channel_config_schema(channel: "telegram" | "feishu" | "qq") {
  return z.object({
    enabled: z.boolean()
      .optional()
      .meta({
        title: "Enabled",
        description: `Whether the ${channel} channel starts with the Chat Plugin.`,
      }),
    channel_account_id: z.string()
      .trim()
      .min(1)
      .optional()
      .meta({
        title: "Chat Account",
        description: `City chat account used by the ${channel} channel.`,
        x_downcity: {
          control: "resource_select",
          resource_type: "channel_account",
          filter: { channel },
        },
      }),
  }).strict().meta({
    title: `${channel} channel`,
    description: `Runtime binding for the ${channel} chat channel.`,
  });
}

/** Chat Plugin 完整配置 Schema。 */
export const chat_plugin_config_schema = z.object({
  queue: z.object({
    max_concurrency: z.number()
      .int()
      .min(1)
      .max(32)
      .optional()
      .meta({
        title: "Maximum concurrency",
        description: "Maximum number of chat lanes executed concurrently.",
      }),
    merge_debounce_ms: z.number()
      .int()
      .min(0)
      .max(60_000)
      .optional()
      .meta({
        title: "Merge debounce",
        description: "Debounce window used to merge consecutive inbound messages.",
      }),
    merge_max_wait_ms: z.number()
      .int()
      .min(0)
      .max(120_000)
      .optional()
      .meta({
        title: "Maximum merge wait",
        description: "Maximum time to wait before executing a merged inbound burst.",
      }),
  }).strict().optional().meta({
    title: "Queue",
    description: "Chat queue scheduling and inbound message merge behavior.",
  }),
  channels: z.object({
    telegram: create_chat_channel_config_schema("telegram").optional(),
    feishu: create_chat_channel_config_schema("feishu").optional(),
    qq: create_chat_channel_config_schema("qq").optional(),
  }).strict().optional().meta({
    title: "Channels",
    description: "Messaging channels connected to this Agent.",
  }),
}).strict().meta({
  title: "Chat Plugin",
  description: "Chat queue and messaging channel bindings.",
});

/** Chat Plugin 完整结构化配置。 */
export type ChatPluginConfig = z.infer<typeof chat_plugin_config_schema>;

/** 供 City Plugin Catalog 使用的标准 JSON Schema。 */
export const CHAT_PLUGIN_CONFIG_JSON_SCHEMA = z.toJSONSchema(
  chat_plugin_config_schema,
  { target: "draft-2020-12" },
) as JsonObject;

/** 在运行时装配边界解析并收窄 Chat Plugin 配置。 */
export function parse_chat_plugin_config(input: unknown): ChatPluginConfig {
  return chat_plugin_config_schema.parse(input);
}

/** 读取单个 Chat channel 在标准配置协议中的 JSON Schema。 */
export function get_chat_channel_config_json_schema(
  channel: ChatChannelName,
): JsonObject {
  const root_properties = CHAT_PLUGIN_CONFIG_JSON_SCHEMA.properties as JsonObject | undefined;
  const channels_schema = root_properties?.channels as JsonObject | undefined;
  const channel_properties = channels_schema?.properties as JsonObject | undefined;
  const schema = channel_properties?.[channel];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`Missing Chat channel config schema: ${channel}`);
  }
  return JSON.parse(JSON.stringify(schema)) as JsonObject;
}
