/**
 * @downcity/downtown 公共入口。
 * Downtown 统一提供本地运行与远端业务访问。
 * 平台数据库 Adapter 由宿主注入，包根入口不加载 Node 原生数据库。
 */

export type { UserSessionCredentials } from "./types/UserSession.js";
export type { ServiceRequestOptions } from "./types/ServiceRequest.js";
export type {
  ApiSchema, ApiExample, ApiError, ApiDocumentation,
  ServiceAvailability, ServiceAvailabilityCheck, ServiceDiscoveryOptions,
} from "./types/ServiceDiscovery.js";
export type {
  PublicApiDocumentation, ServiceEndpointSummary, ServiceEndpointDetail,
  ServiceCatalogSummary, ServiceCatalogDetail,
} from "./types/ServiceCatalog.js";
export { Downtown } from "./access/Downtown.js";
export { DowntownUser } from "./access/DowntownUser.js";
export { DowntownAdmin } from "./access/DowntownAdmin.js";
export { DowntownAccount } from "./access/DowntownAccount.js";
export type { RelayAdminMetadata, RelayAdminTemplate, RelayAdminHealth, RelayAdminDeploymentHealth } from "./types/RelayAdmin.js";
export { DowntownRelay, DowntownRelayAdmin } from "./access/DowntownRelay.js";
export type {
  RelayCatalog, RelayChannel, RelayDeployment, RelayModel, RelayRoute,
  RelayKeyPolicy, RelayKeyInfo, RelayKeyIssued, RelayKeyUpdate,
  RelayLogQuery, RelayRequestLog, RelayAttemptRecord,
  RelayKeyList, RelayRequestPage, RelayAttemptList, RelayCatalogSnapshot, RelayCatalogUpdated,
} from "./types/Relay.js";
export type { DowntownOptions, LocalDowntownOptions, RemoteDowntownOptions } from "./access/types/DowntownOptions.js";
export type {
  DowntownAccountContinueInput,
  DowntownAccountExchangeInput,
  DowntownAccountDoneResult,
  DowntownAccountInputField,
  DowntownAccountInputRequiredResult,
  DowntownAccountLoginBaseResult,
  DowntownAccountLoginOptions,
  DowntownAccountLoginResult,
  DowntownAccountLoginStartInput,
  DowntownAccountPendingResult,
  DowntownAccountProvider,
  DowntownAccountRedirectResult,
} from "./access/types/DowntownAccount.js";
export type {
  DowntownCurrentUser,
  DowntownCurrentUserIdentity,
} from "./access/types/DowntownUser.js";
export type {
  DowntownAdminLoginRequest,
  DowntownAdminSession,
  DowntownCurrentAdmin,
} from "./access/types/DowntownAdmin.js";

// ===========================================================================
// 场景 1：创建 Downtown 实例
// ===========================================================================


export type { DowntownHttpLimits, DowntownHttpPolicy, DowntownHttpRoutePolicy } from "./types/DowntownHttp.js";
export type {
  DowntownStartupTiming,
  DowntownHealthStatus,
} from "./downtown/types.js";
export {
  create_downtown_admin_credentials,
  create_downtown_admin_password_hash,
} from "./downtown/auth/admin-password.js";
export type {
  DowntownAdminLoginInput,
  DowntownAdminLoginResult,
} from "./downtown/auth/types.js";
export type { DowntownFetchOptions, DowntownRequestExecutionContext } from "./downtown/types.js";
export type {
  Runtime,
  EnvProvider,
  BuiltinTables,
  TableDef,
} from "./downtown/runtime.js";
export type {
  CityQueueAdapter as DowntownQueueAdapter,
  CityQueueMessage as DowntownQueueMessage,
} from "./downtown/queue.js";
export { DowntownQueueUnavailableError } from "./downtown/queue.js";
export { R2Storage } from "./downtown/storage.js";
export type {
  DowntownStorage,
  DowntownStorageStoreInput,
  DowntownStorageStoreResult,
  R2BucketLike,
  R2StorageOptions,
} from "./downtown/storage.js";
export type {
  DowntownMiddleware,
  DowntownMiddlewareContext,
  DowntownMiddlewareDowntownRef,
  DowntownMiddlewareNext,
} from "./types/DowntownMiddleware.js";

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
  ActionOptions,
  ServiceActionDefinition,
  ServiceNativeRouteDefinition,
  ServiceNativeRouteHandler,
  ServiceRouteMethod,
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
  ServiceActionRouteConfig,
  ServiceNativeRouteConfig,
} from "./service/installable-service.js";

export type {
  InstructionDefinition,
  InstructionContext,
  InstructionActionDefinition,
  InstructionNativeRouteDefinition,
  InstructionCapable,
} from "./service/instruction.js";

export { AIService } from "./service/ai/ai-service.js";
export { AIChannel } from "./service/ai/AIChannel.js";
export {
  create_openai_compatible_model,
  stream_openai_compatible_model,
} from "./service/ai/OpenAICompatibleModelAdapter.js";
export { read_resolved_reasoning } from "./service/ai/reasoning.js";
export { calculate_model_price, select_model_pricing } from "./service/ai/model-pricing.js";

export type {
  AIChannelOptions,
  AIChannelActionInput,
  AIChannelModel,
  AIChannelStreamInput,
  AIModelSpec,
  AIModelDefinition,
  AIModelFallbackRule,
  AIServiceOptions,
  AIModelStreamPolicy,
  AIChannelStreamResult,
  AIProviderRequestMetadata,
  AIResolvedReasoning,
  AICharge,
  AICreditsBridge,
  AICreditsChargeInput,
  AIBill,
  AIBillInput,
  AIChargedResult,
  AIActionFilePart,
  AIActionMessage,
  AIActionMessagePart,
  AIActionTextPart,
  AIDecisionAnswer,
  AIDecisionQuestion,
  AIDecisionQuestionType,
  AIDecisionRequest,
  AIDecisionResult,
  AIDecisionState,
  AIImageCreateResult,
  AIImageResult,
} from "./types/AI.js";

export type {
  OpenAICompatibleModelAdapterOptions,
  OpenAICompatibleModelClientOptions,
} from "./types/OpenAICompatibleModel.js";

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
  build_image_message,
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

export type { ExtractedImage } from "./service/ai/helpers.js";

// ===========================================================================
// 场景 3：用户鉴权与 Token
// ===========================================================================

export type {
  RuntimeUser,
  CreateUserTokenInput,
  UserTokenPayload,
  UserTokenIssueResult,
  DowntownDiscovery,
  DowntownJwks,
  DowntownPublicJwk,
} from "./downtown/auth/types.js";


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
  DowntownTableSchema,
  ServiceDatabaseContext,
} from "./types/database/Database.js";
export type { DrizzleDatabase } from "./store/db.js";
export { TableApi } from "./store/table-api.js";
export type { CityTableApi as DowntownTableApi } from "./store/table-api.js";
export type { CityUserSchemaInput as DowntownDatabaseSchemaInput } from "./store/types.js";

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
  CityModelDescriptor as DowntownModelDescriptor,
  CityModelEnvRequirement as DowntownModelEnvRequirement,
  CityModelReasoning as DowntownModelReasoning,
  CityModelReasoningEffort as DowntownModelReasoningEffort,
} from "@downcity/type";

export { AIInvoker, ModelCatalog } from "./pact/invoker/ai/index.js";
export { CityModel as DowntownModel } from "./pact/invoker/ai/CityModel.js";
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
  DowntownActionInput,
  UserServiceSummary,
  UserStreamChunk,
  UserStreamResult,
  UserVideoResult,
} from "./pact/user/types.js";

export type {
  UserPaymentMethod as PaymentMethod,
  UserPaymentMethodReason as PaymentMethodReason,
  UserPaymentMethodType as PaymentMethodType,
} from "./pact/invoker/payment/types.js";

export type {
  DowntownModelInput,
  DowntownModelStreamInput,
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
