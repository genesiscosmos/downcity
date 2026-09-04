/**
 * @downcity/city — City 组合根、Plugin 生命周期与 HTTP/RPC transport。
 *
 * City 维护多 Agent 运行时引用并提供可选 HTTP/RPC transport。
 * Agent 与 Session 执行能力由 `@downcity/agent` 提供，Workspace 资源由
 * `@downcity/workspace` 提供。
 */

export { City } from "./city/runtime/City.js";
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
