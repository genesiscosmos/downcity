/**
 * @downcity/city/local — City 本地持久化与产品配置入口。
 *
 * 该入口只暴露无业务语义的数据库和路径能力。Agent、Workspace、Power 等
 * 数据库、路径、配置 Repository、环境装配与 Power Loader 由同一入口提供。
 */

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
export { RootLease, resolve_resource_root, get_root_identity, resource_root_exists } from "./resources/RootLease.js";
export { assert_session_storage_ready, SESSION_STORAGE_MARKER } from "./resources/SessionStorageReadiness.js";
export { ResourceError, as_resource_error } from "./resources/ResourceError.js";
export { ManagementChannel, request_management, MANAGEMENT_VERSION } from "./resources/ManagementChannel.js";
export type { ResourceDispatcher } from "./resources/ManagementChannel.js";
export { validate_resource_input } from "./resources/ResourceInput.js";
export { ResourceService } from "./resources/ResourceService.js";
export { ResourceStore } from "./resources/ResourceStore.js";
export { ResourceCoordinator } from "./resources/ResourceCoordinator.js";
export type { ResourceDependencies, ResourceHost } from "./resources/types.js";
