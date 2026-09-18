/**
 * @downcity/city — City 组合根、Power 生命周期与 HTTP/RPC transport。
 *
 * City 维护多 Agent 运行时引用并提供可选 HTTP/RPC transport。根入口额外导出
 * 应用装配常用的 Agent、Workspace、Shell 与 Storage 构造器；Power、Workspace
 * 和 Shell 的专业 API 由本 package 的稳定子路径提供。
 */

export { City } from "./city/runtime/City.js";
export { Agent, Group } from "@downcity/agent";
export { RemoteAgent } from "./remote/RemoteAgent.js";
export type {
  AgentOptions,
  GroupOptions,
} from "@downcity/agent";
export type { CityRuntime } from "@downcity/type";
export type { RemoteAgentOptions } from "./types/remote/RemoteAgentOptions.js";
export {
  LocalFileSystem,
  LocalStorageProvider,
  MemoryStorageProvider,
  Workspace,
} from "@/workspace/index.js";
export { Shell } from "@/shell/index.js";
export type {
  LocalFileSystemOptions,
  StorageProvider,
  WorkspaceOptions,
} from "@/workspace/index.js";
export type { ShellOptions } from "@/shell/index.js";
export type {
  CityAgents,
  CityGroups,
  CityListenOptions,
  CityOptions,
  CityRuntimeOptions,
  CityWorkspaces,
} from "./city/types/City.js";
export type {
  CityPowerCollection,
  CityPowerHost,
  CityPowerInput,
  CityPowers,
} from "./city/types/CityPower.js";
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
