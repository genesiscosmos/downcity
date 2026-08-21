/**
 * @downcity/city - Agent 内存索引与 HTTP/RPC 转发器。
 *
 * City 维护多 Agent 运行时引用并提供可选 HTTP/RPC transport。
 * AgentWorkspace、Session 与 Plugin 执行能力由 `@downcity/agent` 提供，Workspace 资源由
 * `@downcity/workspace` 提供。
 */

export { City } from "./runtime/City.js";
export type {
  CityAgentBinding,
  CityListenOptions,
  CityOptions,
  CityRuntimeOptions,
} from "./types/City.js";
export type {
  PluginHostContext,
  PluginHostExtensions,
  PluginSetupModule,
} from "./types/PluginHostContext.js";
export {
  create_city_host_instance_id,
  get_city_host_state_path,
  is_process_alive,
  read_city_host_state,
  register_city_host,
  request_city_host_shutdown,
  unregister_city_host,
  wait_for_city_host_exit,
} from "./host/CityHostRegistry.js";
export type { CityHostOwner, CityHostState } from "./host/CityHostRegistry.js";

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
export type { CityAgentHttpExtension } from "./transport/types/CityHttpRuntime.js";
export type {
  AgentRpcBinding,
  AgentRpcListenOptions,
} from "./transport/types/AgentRpcBinding.js";
export type { AgentRpcRuntimeOptions } from "./transport/types/AgentRpcRuntime.js";
export type { CityRpcRuntimeOptions } from "./transport/types/CityRpcRuntime.js";
export type { AgentSessionModelResolver } from "./transport/types/AgentSessionModelResolver.js";
