/**
 * @downcity/city/local — City 本地持久化与产品配置入口。
 *
 * 该入口只暴露无业务语义的数据库和路径能力。Agent、Workspace、Power 等
 * 数据库、路径、配置 Repository、环境装配与 Power Loader 由同一入口提供。
 */

export { TownConnectionRepository, TownConnectionConflictError } from "./repositories/TownConnectionRepository.js";
export { TownImageJobRepository } from "./repositories/TownImageJobRepository.js";
export { normalize_town_url } from "./runtime/TownConnectionMigration.js";
export type { TownConnection, TownAccount, TownAccountInput, TownCredentials, TownConnectionInput, TownConnectionListOptions } from "./types/TownConnection.js";
export { UserSessionRepository, UserSessionExpiredError } from "./repositories/UserSessionRepository.js";
export type { StoredUserSession } from "./types/UserSession.js";
export { UserRepository, LOCAL_USER_ID } from "./repositories/UserRepository.js";
export type { LocalUser } from "./repositories/UserRepository.js";

export { CityTokenRepository } from "./repositories/CityTokenRepository.js";
export type { CityTokenScope, CityTokenSummary, CityTokenConfig, IssuedCityToken } from "./types/CityToken.js";

export { LocalDatabase } from "./database/LocalDatabase.js";
export { resolve_local_city_id } from "./runtime/LocalCityIdentity.js";
export type {
  LocalDatabaseMutationResult,
  LocalDatabaseOptions,
  LocalDatabaseQueryResult,
  LocalDatabaseStatement,
  LocalDatabaseTransaction,
  LocalDatabaseValue,
  LocalPreparedMutationResult,
  LocalPreparedStatement,
} from "./types/Database.js";
export {
  get_local_database_path,
  get_local_agent_path,
  get_local_agents_path,
  get_local_env_path,
  get_local_power_path,
  get_local_powers_path,
  resolve_local_root_path,
} from "./runtime/LocalPaths.js";

export * from "./product.js";
export { ExtensionRepository } from "./repositories/ExtensionRepository.js";
export { ExtensionManager } from "./extensions/ExtensionManager.js";
export { ExtensionPlatform } from "./extensions/ExtensionPlatform.js";
export { ExtensionService } from "./extensions/ExtensionService.js";
export { ExtensionHost } from "./extensions/ExtensionHost.js";
export { ExtensionModelRegistry } from "./extensions/ExtensionModelRegistry.js";
export { extension_browser_runtime_source } from "./extensions/ExtensionBrowserRuntime.js";
export type { ExtensionPowerView, ExtensionRendererArtifact } from "./types/ExtensionRenderer.js";
export { ExtensionFailure } from "./extensions/ExtensionError.js";
export { resolve_extension_host_modules } from "./extensions/ExtensionModules.js";
export { normalize_extension_source } from "./extensions/ExtensionSource.js";
export type { ExtensionSource, ExtensionResult, ExtensionConfigurationView, ExtensionRecord, ExtensionSnapshot, ExtensionRuntime, ExtensionManagerOptions } from "./types/Extension.js";
export type { ExtensionCatalog, ExtensionHostOptions } from "./types/ExtensionHost.js";
export { RootLease, resolve_resource_root, get_root_identity, resource_root_exists } from "./resources/RootLease.js";
export { assert_session_storage_ready, SESSION_STORAGE_MARKER } from "./resources/SessionStorageReadiness.js";
export { ResourceError, as_resource_error } from "./resources/ResourceError.js";
export { ManagementChannel, request_management, MANAGEMENT_VERSION } from "./resources/ManagementChannel.js";
export type { ResourceDispatcher } from "./resources/ManagementChannel.js";
export { validate_resource_input } from "./resources/ResourceInput.js";
export { ResourceService } from "./resources/ResourceService.js";
export { ResourceStore } from "./resources/ResourceStore.js";
export { resource_revision, ResourceCoordinator } from "./resources/ResourceCoordinator.js";
export { LocalHostClient, select_local_host } from "./resources/LocalHostClient.js";
export type { LocalHostClientOptions, LocalHostCallOptions, LocalHostTransport, LocalHostSelection } from "./types/LocalHostClient.js";
export type { ResourceDependencies, ResourceHost } from "./resources/types.js";

export { TownServiceDispatcher, TOWN_SERVICE_CAPABILITIES } from "./resources/TownServiceDispatcher.js";
export type { TownResponseOpen, TownResponseChunk } from "./resources/TownServiceDispatcher.js";

export type { ResourceChange } from "./resources/types/ResourceChange.js";
