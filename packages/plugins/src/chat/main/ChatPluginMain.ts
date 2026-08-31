/** Chat Plugin Profile 的 main actions 与凭据边界。 */

import {
  define_plugin_main,
  type PluginJsonObject,
  type PluginJsonValue,
} from "@downcity/plugin";
import type { ChatPluginChannelConfig } from "@/chat/types/ChatPluginChannelConfig.js";
import type { ChatPluginConfig } from "@/chat/types/ChatPluginConfig.js";
import type {
  ChatPluginPublicChannelConfig,
  ChatPluginPublicProfile,
  ChatPluginPublicQueueConfig,
} from "@/chat/types/ChatPluginProfile.js";

/** Chat Plugin 的宿主管理入口。 */
export const CHAT_PLUGIN_MAIN = define_plugin_main({
  activate({ plugin }) {
    plugin.config_action({
      id: "profile.read",
      run: async (_input, context) => to_public_profile(
        await context.config.get() as unknown as ChatPluginConfig,
      ) as unknown as PluginJsonValue,
    });
    plugin.config_action({
      id: "profile.save",
      run: async (input, context) => {
        const current = await context.config.get() as unknown as ChatPluginConfig;
        const config = normalize_profile(input, current);
        await context.config.set(config as unknown as PluginJsonObject);
        return to_public_profile(config) as unknown as PluginJsonValue;
      },
    });
  },
});

/** 把完整配置转换为不包含凭据原文的 Mainview 投影。 */
function to_public_profile(config: ChatPluginConfig): ChatPluginPublicProfile {
  return {
    queue: { ...(config.queue ?? {}) },
    channels: (config.channels ?? []).map((channel) => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      ...(channel.type !== "telegram" ? { app_id: channel.app_id } : {}),
      ...(channel.type === "feishu" && channel.domain ? { domain: channel.domain } : {}),
      ...(channel.type === "qq" ? { sandbox: channel.sandbox === true } : {}),
      secret_configured: channel.type === "telegram"
        ? Boolean(channel.bot_token)
        : Boolean(channel.app_secret),
    })),
  };
}

/** 校验 Mainview 草稿并补回未重新填写的已有凭据。 */
function normalize_profile(
  input: PluginJsonValue | undefined,
  current: ChatPluginConfig,
): ChatPluginConfig {
  const profile = as_record(input, "Chat Profile");
  const queue = normalize_queue(profile.queue);
  const channel_values = profile.channels;
  if (!Array.isArray(channel_values)) throw new Error("Chat channels must be an array");
  const channel_types = new Set<string>();
  const channel_ids = new Set<string>();
  const channels = channel_values.map((value) => {
    const channel = normalize_channel(value, current.channels ?? []);
    if (channel_types.has(channel.type)) {
      throw new Error(`Chat Channel type is duplicated: ${channel.type}`);
    }
    if (channel_ids.has(channel.id)) {
      throw new Error(`Chat Channel ID is duplicated: ${channel.id}`);
    }
    channel_types.add(channel.type);
    channel_ids.add(channel.id);
    return channel;
  });
  return {
    ...(Object.keys(queue).length > 0 ? { queue } : {}),
    channels,
  };
}

/** 校验 Chat 队列配置。 */
function normalize_queue(value: PluginJsonValue | undefined): ChatPluginPublicQueueConfig {
  if (value === undefined) return {};
  const queue = as_record(value, "Chat queue");
  return {
    ...read_integer(queue, "max_concurrency", 1, 32),
    ...read_integer(queue, "merge_debounce_ms", 0, 60000),
    ...read_integer(queue, "merge_max_wait_ms", 0, 120000),
  };
}

/** 校验并规范化一个 Chat Channel。 */
function normalize_channel(
  value: PluginJsonValue,
  current_channels: ChatPluginChannelConfig[],
): ChatPluginChannelConfig {
  const channel = as_record(value, "Chat Channel");
  const id = read_required_string(channel, "id");
  const name = read_required_string(channel, "name");
  const type = read_required_string(channel, "type");
  const current = current_channels.find((item) => item.id === id && item.type === type);
  if (type === "telegram") {
    const bot_token = read_optional_string(channel, "bot_token")
      || (current?.type === "telegram" ? current.bot_token : "");
    if (!bot_token) throw new Error(`Telegram Bot Token is required: ${id}`);
    return { id, type, name, bot_token };
  }
  if (type === "feishu") {
    const app_id = read_required_string(channel, "app_id");
    const app_secret = read_optional_string(channel, "app_secret")
      || (current?.type === "feishu" ? current.app_secret : "");
    if (!app_secret) throw new Error(`Feishu App Secret is required: ${id}`);
    const domain = read_optional_string(channel, "domain");
    return { id, type, name, app_id, app_secret, ...(domain ? { domain } : {}) };
  }
  if (type === "qq") {
    const app_id = read_required_string(channel, "app_id");
    const app_secret = read_optional_string(channel, "app_secret")
      || (current?.type === "qq" ? current.app_secret : "");
    if (!app_secret) throw new Error(`QQ App Secret is required: ${id}`);
    return { id, type, name, app_id, app_secret, sandbox: channel.sandbox === true };
  }
  throw new Error(`Unsupported Chat Channel type: ${type}`);
}

/** 读取一个受范围约束的可选整数字段。 */
function read_integer(
  source: PluginJsonObject,
  key: string,
  minimum: number,
  maximum: number,
): Partial<Record<string, number>> {
  const value = source[key];
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid Chat Profile field: ${key}`);
  }
  return { [key]: value };
}

/** 要求一个值是 JSON object。 */
function as_record(value: PluginJsonValue | undefined, label: string): PluginJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

/** 读取并规范化必填字符串。 */
function read_required_string(source: PluginJsonObject, key: string): string {
  const value = read_optional_string(source, key);
  if (!value) throw new Error(`Chat Profile field is required: ${key}`);
  return value;
}

/** 读取并规范化可选字符串。 */
function read_optional_string(source: PluginJsonObject, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}
