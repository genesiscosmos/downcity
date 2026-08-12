/**
 * @downcity/city - Agent 宿主环境公开 API。
 *
 * City 统一拥有多 Agent 集合、本地持久化装配和可选 HTTP/RPC transport。
 * 单 Agent 的 Workspace、Session 与 Plugin 执行能力仍由 `@downcity/agent` 提供。
 */

export { City } from "./runtime/City.js";
export { MemoryCityStore } from "./runtime/MemoryCityStore.js";
export type { CityState } from "./types/City.js";
export type { CityStore } from "./types/CityStore.js";

export { LocalCityStore } from "./local/LocalCityStore.js";
export type {
  LocalCityStoreRuntimeOptions,
  LocalModelResolver,
  LocalPluginType,
} from "./local/types/LocalRuntime.js";
export type {
  LocalAgentConfig,
  LocalCityStoreOptions,
  LocalWorkspaceConfig,
  NewLocalAgentInput,
} from "./local/types/LocalCity.js";
export type {
  LocalAgentPluginBinding,
  LocalPluginInstallation,
  LocalPluginInstallationManifest,
  LocalPluginManifest,
  LocalPluginResource,
  LocalPluginResourceItem,
} from "./local/types/LocalPlugin.js";
export {
  normalize_installation_id,
  normalize_plugin_name,
  normalize_resource_id,
} from "./local/store/LocalPluginRepository.js";
export {
  get_local_database_path,
  get_local_env_path,
  get_local_key_path,
  get_local_plugins_path,
  resolve_local_root_path,
} from "./local/store/LocalPaths.js";

export { AgentHTTP } from "./transport/http/AgentHTTP.js";
export { CityHTTP } from "./transport/http/CityHTTP.js";
export type { AgentHttpServerHandle } from "./transport/http/AgentHTTP.js";
export { AgentRPC } from "./transport/rpc/AgentRPC.js";
export { CityRPC } from "./transport/rpc/CityRPC.js";
export type {
  AgentHttpBinding,
  AgentHttpListenOptions,
} from "./transport/types/AgentHttpBinding.js";
export type { AgentHttpRuntimeOptions } from "./transport/types/AgentHttpRuntime.js";
export type { CityHttpRuntimeOptions } from "./transport/types/CityHttpRuntime.js";
export type {
  AgentRpcBinding,
  AgentRpcListenOptions,
} from "./transport/types/AgentRpcBinding.js";
export type { AgentRpcRuntimeOptions } from "./transport/types/AgentRpcRuntime.js";
export type { CityRpcRuntimeOptions } from "./transport/types/CityRpcRuntime.js";
export type { AgentSessionModelResolver } from "./transport/types/AgentSessionModelResolver.js";
