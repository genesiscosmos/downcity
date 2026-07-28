/**
 * Chat Plugin 导出入口。
 *
 * 关键点（中文）
 * - Index 只负责导出类实现与 channel SDK 对象。
 * - 真正的类实现位于 `ChatPlugin.ts`。
 */
export { ChatPlugin } from "./ChatPlugin.js";
export {
  FeishuChannel,
  QqChannel,
  TelegramChannel,
} from "./channels/RuntimeChannel.js";
export {
  CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  chat_plugin_config_schema,
  get_chat_channel_config_json_schema,
  parse_chat_plugin_config,
} from "./config/ChatPluginConfig.js";
export type {
  BaseChatChannelOptions,
  ChatChannelEnv,
  FeishuChannelOptions,
  QqChannelOptions,
  TelegramChannelOptions,
} from "./channels/RuntimeChannel.js";
export type {
  ChatChannel,
  ChatPluginOptions,
} from "./types/ChatPluginOptions.js";
export type { ChatPluginConfig } from "./config/ChatPluginConfig.js";
export type {
  ChatChannelAccountStore,
  StoredChannelAccount,
  StoredChannelAccountChannel,
  UpsertChannelAccountInput,
} from "./types/ChannelAccountStore.js";
