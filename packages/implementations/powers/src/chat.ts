/**
 * `@downcity/powers/chat` 独立公开入口。
 *
 * 关键点（中文）
 * - 只公开 City 级 ChatPower、Bot Account 配置与 Chat Access 能力。
 * - 不加载其他内建 power 的入口模块。
 */

export { ChatPower } from "./chat/ChatPower.js";
export {
  ChatAccessService,
  is_chat_access_channel,
  resolve_chat_access_scope,
  resolve_chat_access_scopes,
} from "./chat/access/ChatAccessService.js";
export { get_chat_access_db_path } from "./chat/access/ChatAccessStore.js";
export { CHAT_ACCESS_ACTIONS } from "./chat/types/ChatAccess.js";
export type {
  ChatAccountConfig,
  ChatAccountDraft,
  ChatAccountsConfig,
  ChatAccountView,
  ChatProvider,
} from "./chat/types/ChatAccount.js";
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
