/**
 * @downcity/city 公共入口。
 *
 * City 包同时提供服务端 Federation 与客户端 City：
 * - `Federation` 提供全局服务、账户事实源与信任根
 * - `FederationAdmin` 提供独立 Root 控制面
 * - `Bureau` 表示绑定稳定产品身份的服务端节点
 * - `City` 表示连接 Bureau 产品域的 Agent 终端
 */

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
export type { CityQueueAdapter, CityQueueMessage } from "./federation/queue.js";
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

export { Bureau, BureauUser } from "./client/bureau.js";
export { FederationAdmin } from "./pact/admin/index.js";
export type { FederationAdminOptions } from "./pact/admin/types.js";

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
  BureauTokenSummary,
  RegisterBureauTokenInput,
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
export type { CityTableApi } from "./store/table-api.js";
export type { CityUserSchemaInput } from "./store/types.js";

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
  CityModelDescriptor,
  CityModelEnvRequirement,
  CityModelReasoning,
  CityModelReasoningEffort,
} from "@downcity/type";

export { City } from "./client/city.js";
export type { CityOptions } from "./client/types.js";

export { AIInvoker, ModelCatalog } from "./pact/invoker/ai/index.js";
export { CityModel } from "./pact/invoker/ai/CityModel.js";
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
export {
  BureausInvoker,
  BureauTokensInvoker,
} from "./pact/invoker/bureaus/index.js";
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
  BureauTokenRecord,
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
