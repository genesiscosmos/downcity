/**
 * Agent RPC server 内部类型。
 *
 * 关键点（中文）
 * - 这里描述 handler 需要的依赖，不承载 socket 生命周期。
 * - `RpcServer.ts` 负责网络层，handler 把协议方法转成 Agent 操作。
 */

import type { AgentSessions } from "@downcity/agent";
import type { Agent } from "@downcity/agent";
import type { RpcEventFrame } from "@/transport/types/RpcProtocol.js";
import type { AgentSessionModelResolver } from "@/transport/types/AgentSessionModelResolver.js";

/**
 * RPC server 启动参数。
 */
export interface RpcServerStartOptions {
  /** RPC 服务监听端口。 */
  port: number;
  /** RPC 服务监听主机。 */
  host: string;
  /** Session 集合访问口。 */
  sessions: AgentSessions;
  /** Agent 上下文访问口。 */
  get_agent?: () => Agent;
  /** 将远程模型 ID 解析为当前宿主可执行的模型实例。 */
  resolve_session_model?: AgentSessionModelResolver;
  /** 由宿主重新加载并提交 Workspace Env 的能力。 */
  reload_workspace_env?: () => Record<string, string> | Promise<Record<string, string>>;
}

/**
 * RPC request handler 依赖。
 */
export interface RpcRequestHandlerOptions {
  /** Session 集合访问口。 */
  sessions: AgentSessions;
  /** Agent 上下文访问口。 */
  get_agent?: () => Agent;
  /** 将远程模型 ID 解析为当前宿主可执行的模型实例。 */
  resolve_session_model?: AgentSessionModelResolver;
  /** 由宿主重新加载并提交 Workspace Env 的能力。 */
  reload_workspace_env?: () => Record<string, string> | Promise<Record<string, string>>;
}

/**
 * 单个 socket 上的 session 订阅。
 */
export interface RpcSocketSubscription {
  /** 被订阅的 session id。 */
  session_id: string;
  /** 取消订阅函数。 */
  unsubscribe: () => void;
}

/** 写入 RPC 成功帧。 */
export type RpcWriteSuccess = (id: string, data?: unknown) => void;

/** 写入 RPC 失败帧。 */
export type RpcWriteError = (id: string, error: unknown) => void;

/** 写入 RPC 事件帧。 */
export type RpcWriteEvent = (frame: RpcEventFrame) => void;
