/**
 * `@downcity/plugins/chat` 独立公开入口。
 *
 * 关键点（中文）
 * - 汇总 ChatPlugin、运行渠道、账号管理与 Chat Access 公开能力。
 * - 不加载其他内建 plugin 的入口模块。
 */

export { ChatPlugin } from "./chat/ChatPlugin.js";
export {
  FeishuChannel,
  QqChannel,
  TelegramChannel,
} from "./chat/channels/RuntimeChannel.js";
export { ChatChannelAccountManager } from "./chat/accounts/ChannelAccountManager.js";
export {
  ChatAccessService,
  is_chat_access_channel,
  resolve_chat_access_scope,
  resolve_chat_access_scopes,
} from "./chat/access/ChatAccessService.js";
export { get_chat_access_db_path } from "./chat/access/ChatAccessStore.js";
export { CHAT_ACCESS_ACTIONS } from "./chat/types/ChatAccess.js";
export { clean_chat_storage } from "./chat/runtime/ChatStorage.js";
export {
  CHAT_PLUGIN_CONFIG_JSON_SCHEMA,
  chat_plugin_config_schema,
  get_chat_channel_config_json_schema,
  parse_chat_plugin_config,
} from "./chat/config/ChatPluginConfig.js";

export type { ChatChannelAccountListItem } from "./chat/types/ChannelAccount.js";
export type {
  ChatChannelAccountStore,
  StoredChannelAccount,
  StoredChannelAccountChannel,
  UpsertChannelAccountInput,
} from "./chat/types/ChannelAccountStore.js";
export type {
  ChatStorageCleanInput,
  ChatStorageCleanResult,
} from "./chat/types/ChatStorage.js";
export type {
  BaseChatChannelOptions,
  ChatChannelEnv,
  FeishuChannelOptions,
  QqChannelOptions,
  TelegramChannelOptions,
} from "./chat/channels/RuntimeChannel.js";
export type {
  ChatChannel,
  ChatPluginOptions,
} from "./chat/types/ChatPluginOptions.js";
export type { ChatPluginConfig } from "./chat/config/ChatPluginConfig.js";
export type {
  ApproveChatAccessRequestInput,
  ChatAccessDecision,
  ChatAccessDecisionReason,
  ChatAccessEffect,
  ChatAccessGrant,
  ChatAccessIdentityInput,
  ChatAccessPrincipal,
  ChatAccessPrincipalView,
  ChatAccessRequest,
  ChatAccessRequestStatus,
  ChatAccessRequestView,
  ChatAccessScope,
  ChatAccessScopeInput,
  ChatAccessServiceOptions,
  ChatAccessSnapshot,
  DenyChatAccessRequestInput,
  ListChatAccessRequestsInput,
  RevokeChatAccessGrantInput,
  SetChatAccessPrincipalEffectInput,
} from "./chat/types/ChatAccess.js";
