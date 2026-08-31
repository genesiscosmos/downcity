/**
 * @downcity/local/product 本地产品数据组件入口。
 *
 * 该入口提供 Downcity CLI 与 Desktop 使用的 Schema、Repository、环境装配和 Plugin
 * Loader。基础数据库 Adapter 不理解这些产品概念，并继续由包根入口单独暴露。
 */

export { ensure_local_schema } from "./database/LocalSchema.js";
export {
  LocalPluginLoader,
  load_local_agent_plugin_module,
  verify_local_installed_plugin_integrity,
} from "./runtime/LocalPluginLoader.js";
export {
  resolve_local_agent_env,
  resolve_local_global_env,
} from "./runtime/LocalEnvironment.js";
export {
  AgentRepository,
  normalize_agent_id,
  normalize_plugin_id,
} from "./repositories/AgentRepository.js";
export { WorkspaceRepository, normalize_workspace_id } from "./repositories/WorkspaceRepository.js";
export { PluginRepository, normalize_profile_id } from "./repositories/PluginRepository.js";
export { LocalSettingRepository } from "./repositories/LocalSettingRepository.js";
export { GroupRepository, normalize_group_id } from "./repositories/GroupRepository.js";
export type {
  LocalAgentConfig,
  LocalAgentPluginReference,
  LocalGroupConfig,
  LocalWorkspaceConfig,
} from "./types/LocalConfig.js";
export type {
  LocalInstalledPluginDefinition,
  LocalPluginConfig,
  LocalPluginDefinition,
  LocalPluginRegistration,
} from "./types/LocalPlugin.js";
export type {
  LocalPluginLoaderOptions,
} from "./types/LocalRuntime.js";
