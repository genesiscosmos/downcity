/**
 * @downcity/city - Agent 内存索引与 HTTP/RPC 转发器。
 *
 * City 维护多 Agent 运行时引用并提供可选 HTTP/RPC transport。
 * 单 Agent 的 Workspace、Session 与 Plugin 执行能力仍由 `@downcity/agent` 提供。
 */

export { City } from "./runtime/City.js";
export type { CityListenOptions, CityRuntimeOptions } from "./types/City.js";

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
