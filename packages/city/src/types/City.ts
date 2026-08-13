/**
 * City 生命周期类型。
 *
 * City 只维护 Agent 的内存索引与 transport，不表达持久化或 Agent 生命周期。
 */

import type { CityHttpRuntimeOptions } from "@/transport/types/CityHttpRuntime.js";
import type { CityRpcRuntimeOptions } from "@/transport/types/CityRpcRuntime.js";

/** City 构造时可注入的 transport 扩展能力。 */
export interface CityRuntimeOptions {
  /** HTTP transport 的模型解析和宿主扩展路由。 */
  http?: CityHttpRuntimeOptions;

  /** RPC transport 的模型解析与环境刷新能力。 */
  rpc?: CityRpcRuntimeOptions;
}

/** City 同时启动 HTTP 与 RPC transport 的监听参数。 */
export interface CityListenOptions {
  /** HTTP transport 监听参数；省略时不启动 HTTP。 */
  http?: {
    /** HTTP 监听地址。 */
    host?: string;
    /** HTTP 监听端口。 */
    port: number;
  };

  /** RPC transport 监听参数；省略时不启动 RPC。 */
  rpc?: {
    /** RPC 监听地址。 */
    host?: string;
    /** RPC 监听端口。 */
    port?: number;
  };
}
