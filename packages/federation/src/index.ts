/**
 * @downcity/federation 公共入口。
 *
 * Federation 是远程权威服务，Embassy 是统一客户端入口，Bureau 是产品或
 * 业务分区。现有低层协议导出暂时保留，便于仓库内调用方分阶段迁移。
 */

export { Embassy } from "./embassy/Embassy.js";
export { EmbassyUser } from "./embassy/EmbassyUser.js";
export { EmbassyAdmin } from "./embassy/EmbassyAdmin.js";
export { EmbassyAccount } from "./embassy/EmbassyAccount.js";
export {
  EmbassyBureauTokens,
  EmbassyBureauRoute,
  EmbassyBureaus,
} from "./embassy/EmbassyBureaus.js";
export type { EmbassyOptions } from "./embassy/types/EmbassyOptions.js";
export type {
  EmbassyAccountContinueInput,
  EmbassyAccountDoneResult,
  EmbassyAccountInputField,
  EmbassyAccountInputRequiredResult,
  EmbassyAccountLoginBaseResult,
  EmbassyAccountLoginOptions,
  EmbassyAccountLoginResult,
  EmbassyAccountLoginStartInput,
  EmbassyAccountPendingResult,
  EmbassyAccountProvider,
  EmbassyAccountRedirectResult,
} from "./embassy/types/EmbassyAccount.js";
export type {
  EmbassyCurrentUser,
  EmbassyCurrentUserIdentity,
} from "./embassy/types/EmbassyUser.js";
export type {
  EmbassyAdminLoginInput,
  EmbassyAdminSession,
  EmbassyCurrentAdmin,
} from "./embassy/types/EmbassyAdmin.js";
export { Bureau, BureauUser } from "./client/bureau.js";

// ===========================================================================
// 场景 1：创建 Federation 实例
// ===========================================================================

export { Federation } from "./federation/federation.js";
export type {
  FederationOptions,
  FederationHealthStatus,
} from "./federation/types.js";
export {
  create_federation_admin_credentials,
  create_federation_admin_password_hash,
} from "./federation/auth/admin-password.js";
export type {
  FederationAdminLoginInput,
  FederationAdminLoginResult,
} from "./federation/auth/types.js";
export type { FederationFetchOptions, FederationRequestExecutionContext } from "./federation/types.js";
export type {
  Runtime,
  EnvProvider,
  BuiltinTables,
  TableDef,
} from "./federation/runtime.js";
export type {
  CityQueueAdapter as FederationQueueAdapter,
  CityQueueMessage as FederationQueueMessage,
} from "./federation/queue.js";
export { R2Storage } from "./federation/storage.js";
export type {
  FederationStorage,
  FederationStorageStoreInput,
  FederationStorageStoreResult,
  R2BucketLike,
  R2StorageOptions,
} from "./federation/storage.js";
export type {
  FederationMiddleware,
  FederationMiddlewareContext,
  FederationMiddlewareFederationRef,
  FederationMiddlewareNext,
} from "./types/FederationMiddleware.js";

// ===========================================================================
// 场景 2：注册 Service / InstallableService / AI 模型
// ===========================================================================

export { Service } from "./service/service.js";
export { InstallableService } from "./service/installable-service.js";
export { Action } from "./service/action.js";

export type {
  Context,
  RouteAuth,
  EnvRequirement,
} from "./service/service.js";

export type {
  RuntimeMetering,
} from "./types/Metering.js";

export type {
  AsyncJobRecord,
  AsyncJobStatus,
} from "./types/AsyncJob.js";

export type {
  ActionFn,
  HookFn,
} from "./service/action.js";

export type {
  ServiceDefinition,
  ServiceInstallContext,
  ServiceRouteContext,
  ServiceTransactionContext,
  ServiceDatabaseSchema,
  ServiceDatabaseSchemas,
} from "./service/installable-service.js";

export type {
  InstructionDefinition,
  InstructionContext,
  InstructionActionDefinition,
  InstructionCapable,
} from "./service/instruction.js";

export { AIService } from "./service/ai/ai-service.js";
export { AIChannel } from "./service/ai/AIChannel.js";
export { read_resolved_reasoning } from "./service/ai/reasoning.js";

export type {
  AIChannelOptions,
  AIChannelActionInput,
  AIChannelModel,
  AIChannelStreamInput,
  AIModelSpec,
  AIModelDefinition,
  AIModelFallbackMedia,
  AIModelFallbackRule,
  AIServiceOptions,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamResult,
  AISDKProviderOptions,
  AIResolvedReasoning,
  AICharge,
  AICreditsBridge,
  AICreditsChargeInput,
  AIBill,
  AIBillInput,
  AIChargedResult,
  AIImageCreateResult,
  AIImageResult,
} from "./types/AI.js";

export type {
  AIMeteringStatus,
  AIUsageOutcome,
  AISettlementStatus,
  AIUsageRecord,
  AdminAIUsageResult,
  AdminAIUsageUserBucket,
  AdminAIDailyUsageBucket,
  AdminAIUsageDimensionBucket,
  AdminAIHourlyUsageBucket,
  AdminAIPerformanceMetrics,
  AdminUsageQuery,
  AIDailyUsageBucket,
  AIDailyUsageResult,
  AIRecentUsageCursor,
  AIRecentUsageItem,
  AIRecentUsageResult,
  AIUsageReader,
  UserDailyUsageQuery,
  UserRecentAIUsageQuery,
} from "./types/AIUsage.js";

export type {
  CreditsAccount,
  CreditsCardReference,
  CreditsCardsView,
  CreditsChargeInput,
  CreditsEphemeralCard,
  CreditsEphemeralCardCreateInput,
  CreditsEphemeralCardQuery,
  CreditsHistoryQuery,
  CreditsPrimaryCard,
  CreditsUserSummary,
  CreditsTopupInput,
  CreditsTransaction,
  CreditsTransactionEntry,
  CreditsTransactionQuery,
  CreditsUserQuery,
} from "./pact/invoker/credits/types.js";

export {
  buildAssistantMessage,
  buildImageMessage,
  buildToolSet,
  isRecord,
  normalizeAIUsage,
  readErrorMessage,
  readJsonResponse,
  read_required_env,
  readString,
  stripUndefined,
  toRecord,
  trimTrailingSlash,
} from "./service/ai/helpers.js";

export type {
  BuildAssistantMessageResult,
  ExtractedImage,
  ToolCallShape,
} from "./service/ai/helpers.js";

// ===========================================================================
// 场景 3：用户鉴权与 Token
// ===========================================================================

export type {
  RuntimeUser,
  CreateUserTokenInput,
  UserTokenPayload,
  UserTokenIssueResult,
  FederationDiscovery,
  FederationJwks,
  FederationPublicJwk,
  CreateFederationServiceTokenInput,
  FederationServiceTokenIssueResult,
} from "./federation/auth/types.js";

export type {
  BureauIdentity,
  BureauOptions,
  BureauFetch,
} from "./types/Bureau.js";

export type { UserProfile } from "./types/User.js";

// ===========================================================================
// 场景 4：管理环境变量（内置 Service）
// ===========================================================================

export { EnvService } from "./service/env/env-service.js";
export type {
  EnvEntry,
  EnvRefreshResult,
  EnvUpsertInput,
  EnvRequirementStatus,
  EnvCatalogScope,
} from "./service/env/types.js";
export { EnvStore } from "./service/env/env-store.js";

// ===========================================================================
// 场景 5：数据库工具
// ===========================================================================

export { Database } from "./database/Database.js";
export {
  DatabaseClosedError,
  DatabaseSchemaError,
  DatabaseTransactionConflictError,
} from "./types/database/DatabaseError.js";
export type {
  DatabaseMutationResult,
  DatabaseQueryResult,
  DatabaseStatement,
  DatabaseTransaction,
  FederationTableSchema,
  ServiceDatabaseContext,
} from "./types/database/Database.js";
export type { DrizzleDatabase } from "./store/db.js";
export { TableApi } from "./store/table-api.js";
export type { CityTableApi as FederationTableApi } from "./store/table-api.js";
export type { CityUserSchemaInput as FederationDatabaseSchemaInput } from "./store/types.js";

// ===========================================================================
// 场景 6：City 客户端访问入口
// ===========================================================================

export type {
  FetchLike,
  FetchResponseLike,
  RawStreamBody,
  RequestInitLike,
} from "./pact/http.js";

export type {
  CityModelDescriptor as FederationModelDescriptor,
  CityModelEnvRequirement as FederationModelEnvRequirement,
  CityModelReasoning as FederationModelReasoning,
  CityModelReasoningEffort as FederationModelReasoningEffort,
} from "@downcity/type";

export { AIInvoker, ModelCatalog } from "./pact/invoker/ai/index.js";
export { CityModel as FederationModel } from "./pact/invoker/ai/CityModel.js";
export { PaymentInvoker, PaymentMethodHandle } from "./pact/invoker/payment/index.js";
export { UserInvoker } from "./pact/invoker/user/index.js";
export { ServiceClient, ActionClient } from "./pact/invoker/invoker.js";

export type {
  UserPaymentMethod,
  UserPaymentMethodReason,
  UserPaymentMethodType,
  UserImageContent,
  UserImageFileContent,
  UserImageInput,
  UserImageJobCreateResult,
  UserImageJobResult,
  UserImageJobResultInput,
  UserImageJobStatus,
  UserImageMessage,
  UserImageResult,
  UserImageTextContent,
  UserServiceInput,
  UserServiceSummary,
  UserStreamChunk,
  UserStreamResult,
  UserTextResult,
  UserVideoResult,
} from "./pact/user/types.js";

export type {
  UserPaymentMethod as PaymentMethod,
  UserPaymentMethodReason as PaymentMethodReason,
  UserPaymentMethodType as PaymentMethodType,
} from "./pact/invoker/payment/types.js";

export type {
  UserModelRef,
  UserModelInput,
} from "./pact/invoker/ai/types.js";

export {
  CreditsCardsInvoker,
  CreditsHistoryInvoker,
  CreditsInvoker,
  CreditsTransactionsInvoker,
} from "./pact/invoker/credits/index.js";
export { EnvInvoker } from "./pact/invoker/env/index.js";

export type {
  AdminInstructionResult,
  AdminModelRecord,
  AdminServiceSummary,
} from "./pact/admin/types.js";

export type {
  BureauCreateInput,
  BureauMachineIdentity,
  BureauRecord,
  BureauServerRecord,
  BureauServerUpdateInput,
  BureauState,
  BureauTokenIssueResult,
  BureauTokenRecord,
  BureauTokenSummary,
  IssueBureauTokenInput,
  RuntimeBureauToken,
} from "./types/Bureau.js";

// ===========================================================================
// 场景 7：内置表 Schema
// ===========================================================================

export { sqliteEnv, pgEnv } from "./service/env/schema.js";
export { sqliteAsyncJobs, pgAsyncJobs } from "./service/async-job/schema.js";

// ===========================================================================
// 场景 8：工具函数
// ===========================================================================

export {
  randomSecret,
  base64UrlEncode,
  base64UrlDecode,
  base64UrlEncodeBytes,
  base64UrlDecodeBytes,
  timingSafeEqualBytes,
  httpError,
  normalizeEnvKey,
  bearerToken,
  parseDotenvEntries,
} from "./utils/helpers.js";

export {
  create_usage_utc_envelope,
  create_usage_date_formatter,
  format_usage_local_date,
  read_usage_integer,
} from "./utils/UsageDate.js";
