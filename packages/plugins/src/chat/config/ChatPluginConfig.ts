/** Chat Plugin profile 的结构化配置协议。 */

import type { JsonObject } from "@downcity/agent";
import { z } from "zod";
import type { ChatPluginChannelConfig } from "@/chat/types/ChatPluginChannelConfig.js";

const channel_id_schema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u)
  .meta({
    title: "Channel ID",
    description: "Stable channel ID inside this Plugin profile.",
  });

const channel_name_schema = z.string()
  .trim()
  .min(1)
  .meta({ title: "Name", description: "User-visible channel name." });

const secret_schema = z.string().trim().min(1).meta({ writeOnly: true });

/** Telegram 渠道配置 Schema。 */
const telegram_channel_schema = z.object({
  id: channel_id_schema,
  type: z.literal("telegram").meta({ title: "Type" }),
  name: channel_name_schema,
  bot_token: secret_schema.meta({
    title: "Bot Token",
    description: "Telegram Bot API Token.",
    writeOnly: true,
  }),
  username: z.string().trim().min(1).optional().meta({ title: "Username" }),
  bot_user_id: z.string().trim().min(1).optional().meta({ title: "Bot User ID" }),
}).strict().meta({ title: "Telegram", description: "Telegram Bot channel." });

/** Feishu / Lark 渠道配置 Schema。 */
const feishu_channel_schema = z.object({
  id: channel_id_schema,
  type: z.literal("feishu").meta({ title: "Type" }),
  name: channel_name_schema,
  app_id: z.string().trim().min(1).meta({
    title: "App ID",
    description: "Feishu or Lark App ID.",
  }),
  app_secret: secret_schema.meta({
    title: "App Secret",
    description: "Feishu or Lark App Secret.",
    writeOnly: true,
  }),
  domain: z.url().optional().meta({
    title: "Open API Domain",
    description: "Optional Feishu or Lark Open API domain.",
  }),
  identity: z.string().trim().min(1).optional().meta({ title: "Identity" }),
  bot_user_id: z.string().trim().min(1).optional().meta({ title: "Bot User ID" }),
}).strict().meta({ title: "Feishu / Lark", description: "Feishu or Lark Bot channel." });

/** QQ 渠道配置 Schema。 */
const qq_channel_schema = z.object({
  id: channel_id_schema,
  type: z.literal("qq").meta({ title: "Type" }),
  name: channel_name_schema,
  app_id: z.string().trim().min(1).meta({ title: "App ID", description: "QQ Bot App ID." }),
  app_secret: secret_schema.meta({
    title: "App Secret",
    description: "QQ Bot App Secret.",
    writeOnly: true,
  }),
  sandbox: z.boolean().optional().meta({
    title: "Sandbox",
    description: "Whether to use the QQ sandbox environment.",
    default: false,
  }),
  identity: z.string().trim().min(1).optional().meta({ title: "Identity" }),
  bot_user_id: z.string().trim().min(1).optional().meta({ title: "Bot User ID" }),
}).strict().meta({ title: "QQ", description: "QQ Bot channel." });

/** Chat Plugin profile 中单个渠道的 Schema。 */
export const chat_plugin_channel_schema = z.discriminatedUnion("type", [
  telegram_channel_schema,
  feishu_channel_schema,
  qq_channel_schema,
]);

/** Chat Plugin 完整 profile Schema。 */
export const chat_plugin_config_schema = z.object({
  queue: z.object({
    max_concurrency: z.number().int().min(1).max(32).optional().meta({
      title: "Maximum concurrency",
      description: "Maximum number of chat lanes executed concurrently.",
    }),
    merge_debounce_ms: z.number().int().min(0).max(60_000).optional().meta({
      title: "Merge debounce",
      description: "Debounce window used to merge consecutive inbound messages.",
    }),
    merge_max_wait_ms: z.number().int().min(0).max(120_000).optional().meta({
      title: "Maximum merge wait",
      description: "Maximum time to wait before executing a merged inbound burst.",
    }),
  }).strict().optional().meta({
    title: "Queue",
    description: "Chat queue scheduling and inbound message merge behavior.",
  }),
  channels: z.array(chat_plugin_channel_schema).optional().meta({
    title: "Channels",
    description: "Messaging channels owned by this Plugin profile.",
  }),
}).strict().meta({ title: "Chat Plugin", description: "Chat queue behavior and channels." });

/** Chat Plugin 完整结构化 profile。 */
export type ChatPluginConfig = z.infer<typeof chat_plugin_config_schema>;

/** 供 Plugin Catalog 使用的完整 profile JSON Schema。 */
export const CHAT_PLUGIN_CONFIG_JSON_SCHEMA = z.toJSONSchema(
  chat_plugin_config_schema,
  { target: "draft-2020-12" },
) as JsonObject;

/** Chat 渠道子结构的标准 JSON Schema。 */
export const CHAT_PLUGIN_CHANNEL_JSON_SCHEMA = z.toJSONSchema(
  chat_plugin_channel_schema,
  { target: "draft-2020-12" },
) as JsonObject;

/** 在运行时装配边界解析并收窄完整 profile。 */
export function parse_chat_plugin_config(input: unknown): ChatPluginConfig {
  return chat_plugin_config_schema.parse(input);
}

/** 解析一个完整渠道配置。 */
export function parse_chat_plugin_channel(input: unknown): ChatPluginChannelConfig {
  return chat_plugin_channel_schema.parse(input);
}

/** 读取一个渠道类型分支的标准 JSON Schema。 */
export function get_chat_plugin_channel_json_schema(
  channel_type: ChatPluginChannelConfig["type"],
): JsonObject {
  const variants = Array.isArray(CHAT_PLUGIN_CHANNEL_JSON_SCHEMA.oneOf)
    ? CHAT_PLUGIN_CHANNEL_JSON_SCHEMA.oneOf
    : [];
  for (const value of variants) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const variant = value as JsonObject;
    const properties = variant.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) continue;
    const type_schema = (properties as JsonObject).type;
    if (
      type_schema
      && typeof type_schema === "object"
      && !Array.isArray(type_schema)
      && (type_schema as JsonObject).const === channel_type
    ) {
      return JSON.parse(JSON.stringify(variant)) as JsonObject;
    }
  }
  throw new Error(`Missing Chat channel schema: ${channel_type}`);
}
