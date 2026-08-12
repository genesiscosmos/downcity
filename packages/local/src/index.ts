/**
 * @downcity/local 本地 City Store 公开入口。
 *
 * CLI 与 Desktop 通过这里创建共享 `~/.downcity` 数据适配器；数据库和装配细节不外泄。
 */

export { LocalCityStore } from "./LocalCityStore.js";
export type { LocalModelResolver } from "./LocalCityStore.js";
export type { LocalPluginType } from "./store/LocalPluginLoader.js";
export type {
  LocalAgentConfig,
  LocalCityStoreOptions,
  LocalWorkspaceConfig,
  NewLocalAgentInput,
} from "./types/LocalCity.js";
export type {
  LocalAgentPluginBinding,
  LocalPluginInstallation,
  LocalPluginInstallationManifest,
  LocalPluginManifest,
  LocalPluginResource,
  LocalPluginResourceItem,
} from "./types/LocalPlugin.js";
export {
  normalize_installation_id,
  normalize_plugin_name,
  normalize_resource_id,
} from "./store/LocalPluginRepository.js";
export {
  get_local_database_path,
  get_local_env_path,
  get_local_key_path,
  get_local_plugins_path,
  resolve_local_root_path,
} from "./store/LocalPaths.js";
