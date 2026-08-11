/**
 * @downcity/server 包公共入口。
 *
 * 关键点（中文）
 * - 这里只导出 transport 适配类与必要的绑定类型。
 * - Agent 业务能力仍由 `@downcity/agent` 提供，本包不做转出。
 */

export { AgentRPC } from "./rpc/AgentRPC.js";
export { AgentHTTP } from "./http/AgentHTTP.js";
export type { AgentHttpServerHandle } from "./http/AgentHTTP.js";
export type {
  AgentRpcBinding,
  AgentRpcListenOptions,
} from "./types/AgentRpcBinding.js";
export type { AgentRpcRuntimeOptions } from "./types/AgentRpcRuntime.js";
export type { AgentHttpRuntimeOptions } from "./types/AgentHttpRuntime.js";
export type { AgentSessionModelResolver } from "./types/AgentSessionModelResolver.js";
export type {
  AgentHttpBinding,
  AgentHttpListenOptions,
} from "./types/AgentHttpBinding.js";
