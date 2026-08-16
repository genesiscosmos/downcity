/** Chat Plugin profile 的显式 JSON Schema。 */

import type { JsonObject } from "@downcity/agent";
import type { ChatPluginChannelConfig } from "@/chat/types/ChatPluginChannelConfig.js";

const telegram_channel_json_schema: JsonObject = {
  type: "object",
  title: "Telegram",
  description: "Telegram Bot channel.",
  properties: {
    id: { type: "string", minLength: 1, title: "Channel ID" },
    type: { type: "string", const: "telegram" },
    name: { type: "string", minLength: 1, title: "Name" },
    bot_token: { type: "string", minLength: 1, title: "Bot token", writeOnly: true },
    username: { type: "string", minLength: 1, title: "Username" },
    bot_user_id: { type: "string", minLength: 1, title: "Bot user ID" },
  },
  required: ["id", "type", "name", "bot_token"],
  additionalProperties: false,
};

const feishu_channel_json_schema: JsonObject = {
  type: "object",
  title: "Feishu",
  description: "Feishu or Lark Bot channel.",
  properties: {
    id: { type: "string", minLength: 1, title: "Channel ID" },
    type: { type: "string", const: "feishu" },
    name: { type: "string", minLength: 1, title: "Name" },
    app_id: { type: "string", minLength: 1, title: "App ID" },
    app_secret: { type: "string", minLength: 1, title: "App secret", writeOnly: true },
    domain: { type: "string", minLength: 1, title: "Domain" },
    identity: { type: "string", minLength: 1, title: "Identity" },
    bot_user_id: { type: "string", minLength: 1, title: "Bot user ID" },
  },
  required: ["id", "type", "name", "app_id", "app_secret"],
  additionalProperties: false,
};

const qq_channel_json_schema: JsonObject = {
  type: "object",
  title: "QQ",
  description: "QQ Bot channel.",
  properties: {
    id: { type: "string", minLength: 1, title: "Channel ID" },
    type: { type: "string", const: "qq" },
    name: { type: "string", minLength: 1, title: "Name" },
    app_id: { type: "string", minLength: 1, title: "App ID" },
    app_secret: { type: "string", minLength: 1, title: "App secret", writeOnly: true },
    sandbox: { type: "boolean", title: "Sandbox", default: false },
    identity: { type: "string", minLength: 1, title: "Identity" },
    bot_user_id: { type: "string", minLength: 1, title: "Bot user ID" },
  },
  required: ["id", "type", "name", "app_id", "app_secret"],
  additionalProperties: false,
};

/** Chat 渠道联合类型的完整 JSON Schema。 */
export const CHAT_PLUGIN_CHANNEL_JSON_SCHEMA: JsonObject = {
  oneOf: [
    telegram_channel_json_schema,
    feishu_channel_json_schema,
    qq_channel_json_schema,
  ],
};

/** Chat Plugin 完整 profile 的 JSON Schema。 */
export const CHAT_PLUGIN_CONFIG_JSON_SCHEMA: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Chat Plugin",
  description: "Chat queue behavior and channels.",
  properties: {
    queue: {
      type: "object",
      title: "Queue",
      description: "Chat queue scheduling and inbound message merge behavior.",
      properties: {
        max_concurrency: {
          type: "integer",
          minimum: 1,
          maximum: 32,
          title: "Maximum concurrency",
        },
        merge_debounce_ms: {
          type: "integer",
          minimum: 0,
          maximum: 60000,
          title: "Merge debounce",
        },
        merge_max_wait_ms: {
          type: "integer",
          minimum: 0,
          maximum: 120000,
          title: "Maximum merge wait",
        },
      },
      additionalProperties: false,
    },
    channels: {
      type: "array",
      title: "Channels",
      description: "Messaging channels owned by this Plugin profile.",
      items: CHAT_PLUGIN_CHANNEL_JSON_SCHEMA,
    },
  },
  additionalProperties: false,
};

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
      return structuredClone(variant);
    }
  }
  throw new Error(`Missing Chat channel schema: ${channel_type}`);
}
