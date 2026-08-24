/**
 * Agent RPC server 内部类型。
 *
 * 关键点（中文）
 * - 这里描述 handler 需要的依赖，不承载 socket 生命周期。
 * - `RpcServer.ts` 负责网络层，handler 把协议方法转成 Agent 操作。
 */

import type { AgentSessionCollection } from "@/types/agent/AgentSessionCollection.js";
import type { AgentWorkspace } from "@/internal/index.js";
import type { RpcEventFrame } from "@/city/transport/types/RpcProtocol.js";
import type { AgentSessionModelResolver } from "@/city/transport/types/AgentSessionModelResolver.js";

/**
 * RPC server 启动参数。
 */
export interface RpcServerStartOptions {
  /** RPC 服务监听端口。 */
  port: number;
  /** RPC 服务监听主机。 */
  host: string;
  /** Session 集合访问口。 */
  sessions: AgentSessionCollection;
  /** 当前 AgentWorkspace 执行上下文访问口。 */
  get_workspace?: () => AgentWorkspace;
  /** 将远程模型 ID 解析为当前宿主可执行的模型实例。 */
  resolve_session_model?: AgentSessionModelResolver;
  /** 由宿主重新加载并提交 Workspace Env 的能力。 */
  reload_workspace_env?: () => Record<string, string> | Promise<Record<string, string>>;
  /** 按请求选择 Agent 级 handler 依赖；CityRPC 使用该入口完成多 Agent 路由。 */
  resolve_request_options?: (
    request: import("@/city/transport/types/RpcProtocol.js").RpcRequest,
  ) => RpcRequestHandlerOptions | Promise<RpcRequestHandlerOptions>;
}

/**
 * RPC request handler 依赖。
 */
export interface RpcRequestHandlerOptions {
  /** Session 集合访问口。 */
  sessions: AgentSessionCollection;
  /** 当前 AgentWorkspace 执行上下文访问口。 */
  get_workspace?: () => AgentWorkspace;
  /** 将远程模型 ID 解析为当前宿主可执行的模型实例。 */
  resolve_session_model?: AgentSessionModelResolver;
  /** 由宿主重新加载并提交 Workspace Env 的能力。 */
  reload_workspace_env?: () => Record<string, string> | Promise<Record<string, string>>;
  /** 返回 City 宿主身份；仅 CityRPC 提供。 */
  get_city_status?: () => {
    /** 当前 City 加载的 Agent ID。 */
    agent_ids: string[];
  };
  /** 请求当前宿主优雅退出。 */
  shutdown_city?: () => void | Promise<void>;
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
