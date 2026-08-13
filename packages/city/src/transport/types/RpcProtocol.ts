/**
 * City transport 内部使用的 RPC 协议类型 re-export。
 *
 * 关键点（中文）
 * - Agent 请求复用 `@downcity/agent` 的公开 RPC 协议。
 * - City 宿主控制方法只在本包扩展，不进入单 Agent SDK。
 */

export type {
  RpcEventFrame,
  RpcServerFrame,
} from "@downcity/agent";

import type { RpcRequest as AgentRpcRequest } from "@downcity/agent";

/** City 宿主自身的 RPC 控制请求。 */
export type CityControlRpcRequest =
  | {
      /** 请求 ID，用于匹配响应。 */
      id: string;
      /** 读取 City 宿主进程状态。 */
      method: "internal.city.status";
    }
  | {
      /** 请求 ID，用于匹配响应。 */
      id: string;
      /** 请求 City 宿主优雅退出。 */
      method: "internal.city.shutdown";
    };

/** City transport 接受单 Agent 请求和 City 控制请求。 */
export type RpcRequest = AgentRpcRequest | CityControlRpcRequest;
