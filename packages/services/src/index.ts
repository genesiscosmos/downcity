/**
 * @downcity/services 统一公共入口。
 *
 * 关键说明（中文）
 * - 对外统一暴露 Downcity 官方服务
 * - 对外统一暴露 accounts / credits / payment / usage 等官方服务
 * - Email / GitHub / Google / WeChat 统一作为 accounts provider 暴露
 * - Stripe / Creem / Dodo / Waffo 统一作为 payment provider 暴露
 * - 业务侧只需要从一个包完成导入
 */

export { accountsLoginStates, userProfiles } from "./accounts/schema.js";
export {
  AccountsService,
  emailAccountsProvider,
  githubAccountsProvider,
  googleAccountsProvider,
  oauthAccountsProvider,
  wechatAccountsProvider,
} from "./accounts/index.js";
export type { AccountsServiceOptions } from "./accounts/index.js";
export type {
  AccountsAuthFlow,
  AccountsAuthInputField,
  AccountsAuthInputType,
  AccountsEmailProvider,
  AccountsEmailSendParams,
  AccountsLoginContinueRequest,
  AccountsLoginContinueResult,
  AccountsLoginDoneResult,
  AccountsLoginInputRequiredResult,
  AccountsLoginPendingResult,
  AccountsLoginRedirectRequiredResult,
  AccountsLoginResult,
  AccountsLoginResultRequest,
  AccountsLoginStartRequest,
  AccountsLoginStartResult,
  AccountsLoginStatus,
  AccountsOAuthProvider,
  AccountsProvider,
  AccountsProviderContext,
  AccountsProviderItem,
  AccountsProviderKind,
  AccountsProviderReason,
  EmailAccountsProviderOptions,
  OAuthAccountsProviderOptions,
} from "./accounts/types.js";

export {
  CreditsService,
  creditsEphemeralCards,
  creditsPrimaryCards,
  creditsTransactionEntries,
  creditsTransactions,
} from "./credits/index.js";
export type {
  CreditsCardReference,
  CreditsCardsView,
  CreditsChargeInput,
  CreditsEphemeralCard,
  CreditsEphemeralCardCreateInput,
  CreditsEphemeralCardQuery,
  CreditsEphemeralCardStatus,
  CreditsHistoryQuery,
  CreditsPrimaryCard,
  CreditsSummary,
  CreditsTopupInput,
  CreditsUserQuery,
  CreditsTransaction,
  CreditsTransactionEntry,
  CreditsTransactionKind,
  CreditsTransactionQuery,
  CreditsTransactionStatus,
} from "./credits/index.js";
export {
  CREDITS_PER_USD,
  USD_DECIMAL_PLACES,
} from "./types/Amount.js";
export type {
  Credits,
} from "./types/Amount.js";

export {
  creemPaymentProvider,
  dodoPaymentProvider,
  PaymentService,
  stripePaymentProvider,
  waffoPaymentProvider,
} from "./payment/index.js";
export type {
  PaymentCheckoutCreateResult,
  PaymentCreateCheckoutInput,
  PaymentEventRecord,
  PaymentEventSyncStatus,
  PaymentMethodItem,
  PaymentMethodReason,
  PaymentMethodType,
  PaymentProvider,
  PaymentProviderCheckoutInput,
  PaymentProviderCheckoutResult,
  PaymentProviderContext,
  PaymentProviderWebhookEvent,
  PaymentProviderWebhookInput,
  PaymentRecord,
  PaymentServiceOptions,
  PaymentOrderSnapshot,
  PaymentStatus,
  PaymentTopupResolution,
  PaymentTopupResolutionInput,
} from "./payment/types.js";
export type {
  CreemPaymentProviderOptions,
  DodoPaymentProviderOptions,
  StripePaymentProviderOptions,
  WaffoPaymentProviderOptions,
} from "./payment/types.js";

export { FeedbackService, feedbackMessages } from "./feedback/index.js";
export type {
  FeedbackCreateInput,
  FeedbackCreateResult,
  FeedbackMessage,
  FeedbackQueryInput,
  FeedbackReplyInput,
  FeedbackReplyResult,
  FeedbackStatus,
  FeedbackStatusUpdateInput,
  FeedbackStatusUpdateResult,
} from "./feedback/index.js";

export { usageEvents, UsageService } from "./usage/index.js";
export type { UsageServiceOptions } from "./usage/index.js";
