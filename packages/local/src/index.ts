/** @downcity/local 本地数据库 Adapter、产品 Repository 与运行组件出口。 */

export { LocalDatabase } from "./database/LocalDatabase.js";
export { LocalCrypto } from "./database/LocalCrypto.js";
export { ensure_local_schema } from "./database/LocalSchema.js";
export { LocalPluginLoader } from "./runtime/LocalPluginLoader.js";
export { resolve_local_agent_env } from "./runtime/LocalEnvironment.js";
export { AgentRepository, normalize_agent_id } from "./repositories/AgentRepository.js";
export { WorkspaceRepository, normalize_workspace_id } from "./repositories/WorkspaceRepository.js";
export {
  PluginRepository,
  normalize_installation_id,
  normalize_plugin_name,
  normalize_resource_id,
} from "./repositories/PluginRepository.js";
export { SecureSettingRepository } from "./repositories/SecureSettingRepository.js";
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
export type {
  LocalAgentConfig,
  LocalAgentPluginConfig,
  LocalWorkspaceConfig,
} from "./types/LocalConfig.js";
export type {
  LocalAgentPluginBinding,
  LocalPluginInstallation,
  LocalPluginInstallationManifest,
  LocalPluginManifest,
  LocalPluginResource,
  LocalPluginResourceItem,
} from "./types/LocalPlugin.js";
export type {
  LocalPluginLoaderOptions,
  LocalPluginType,
} from "./types/LocalRuntime.js";
export {
  get_local_database_path,
  get_local_env_path,
  get_local_key_path,
  get_local_plugins_path,
  resolve_local_root_path,
} from "./runtime/LocalPaths.js";
