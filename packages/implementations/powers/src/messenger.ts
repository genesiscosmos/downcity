/**
 * `@downcity/powers/messenger` 独立公开入口。
 *
 * 关键点（中文）
 * - 只公开 City 级 MessengerPower、Bot Account 配置与 Messenger Access 能力。
 * - 不加载其他内建 power 的入口模块。
 */

export { MessengerPower } from "./messenger/MessengerPower.js";
export {
  MessengerAccessService,
  is_messenger_access_channel,
  resolve_messenger_access_scope,
  resolve_messenger_access_scopes,
} from "./messenger/access/MessengerAccessService.js";
export { get_messenger_access_db_path } from "./messenger/access/MessengerAccessStore.js";
export { MESSENGER_ACCESS_ACTIONS } from "./messenger/types/MessengerAccess.js";
export type {
  MessengerAccountConfig,
  MessengerAccountDraft,
  MessengerAccountsConfig,
  MessengerAccountView,
  MessengerProvider,
} from "./messenger/types/MessengerAccount.js";
export type {
  ApproveMessengerAccessRequestInput,
  MessengerAccessDecision,
  MessengerAccessDecisionReason,
  MessengerAccessEffect,
  MessengerAccessGrant,
  MessengerAccessIdentityInput,
  MessengerAccessPrincipal,
  MessengerAccessPrincipalView,
  MessengerAccessRequest,
  MessengerAccessRequestStatus,
  MessengerAccessRequestView,
  MessengerAccessScope,
  MessengerAccessScopeInput,
  MessengerAccessServiceOptions,
  MessengerAccessSnapshot,
  DenyMessengerAccessRequestInput,
  ListMessengerAccessRequestsInput,
  RevokeMessengerAccessGrantInput,
  SetMessengerAccessPrincipalEffectInput,
} from "./messenger/types/MessengerAccess.js";
