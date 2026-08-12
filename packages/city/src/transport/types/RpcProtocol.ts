/**
 * City transport 内部使用的 RPC 协议类型 re-export。
 *
 * 关键点（中文）
 * - 直接转出 `@downcity/agent` 的协议类型。
 * - 让 transport 内部模块只依赖一个本地路径，统一复用 `@downcity/agent` 公开 RPC 协议。
 */

export type {
  RpcRequest,
  RpcEventFrame,
  RpcServerFrame,
} from "@downcity/agent";
