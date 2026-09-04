/**
 * @downcity/city — City 组合根、Plugin 生命周期与 HTTP/RPC transport。
 *
 * City 维护多 Agent 运行时引用并提供可选 HTTP/RPC transport。根入口额外导出
 * 应用装配常用的 Agent、Workspace、Shell 与 Storage 构造器；完整专业 API 仍由
 * `@downcity/agent`、`@downcity/workspace` 和 `@downcity/plugin` 提供。
 */

export { City } from "./city/runtime/City.js";
export { Agent, Group, RemoteAgent } from "@downcity/agent";
export type {
  AgentOptions,
  GroupOptions,
  RemoteAgentOptions,
} from "@downcity/agent";
export {
  LocalFileSystem,
  LocalStorageProvider,
  MemoryStorageProvider,
  Shell,
  Workspace,
  WorkspaceBase,
} from "@downcity/workspace";
export type {
  LocalFileSystemOptions,
  ShellOptions,
  StorageProvider,
  WorkspaceOptions,
} from "@downcity/workspace";
export type {
  CityAgents,
  CityGroups,
  CityListenOptions,
  CityOptions,
  CityRuntimeOptions,
  CityWorkspaces,
} from "./city/types/City.js";
export type {
  CityAgentPluginBinding,
  CityAgentPluginOptions,
  CityPluginHost,
  CityPlugins,
} from "./city/types/CityPlugin.js";
export {
  create_city_host_instance_id,
  get_city_host_state_path,
  is_process_alive,
  read_city_host_state,
  register_city_host,
  request_city_host_shutdown,
  unregister_city_host,
  wait_for_city_host_exit,
} from "./city/host/CityHostRegistry.js";
export type { CityHostOwner, CityHostState } from "./city/host/CityHostRegistry.js";

/** Transport 实现由 City.http() / City.rpc() 持有，不作为独立构造器公开。 */
export type {
  AgentHttpBinding,
  AgentHttpListenOptions,
} from "./city/transport/types/AgentHttpBinding.js";
export type { AgentHttpRuntimeOptions } from "./city/transport/types/AgentHttpRuntime.js";
export type { CityHttpRuntimeOptions } from "./city/transport/types/CityHttpRuntime.js";
export type { CityAgentHttpExtension } from "./city/transport/types/CityHttpRuntime.js";
export type {
  AgentRpcBinding,
  AgentRpcListenOptions,
} from "./city/transport/types/AgentRpcBinding.js";
export type { AgentRpcRuntimeOptions } from "./city/transport/types/AgentRpcRuntime.js";
export type { CityRpcRuntimeOptions } from "./city/transport/types/CityRpcRuntime.js";
export type { AgentSessionModelResolver } from "./city/transport/types/AgentSessionModelResolver.js";
