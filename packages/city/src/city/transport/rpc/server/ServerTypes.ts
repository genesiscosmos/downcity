/**
 * Agent RPC server 内部类型。
 *
 * 关键点（中文）
 * - 这里描述 handler 需要的依赖，不承载 socket 生命周期。
 * - `RpcServer.ts` 负责网络层，handler 把协议方法转成 Agent 操作。
 */

import type { AgentSessionCollection } from "@downcity/agent";
import type { Agent } from "@downcity/agent";
import type { AgentPluginRuntime } from "@/plugin/types/PluginExecutionRuntime.js";
import type { PluginSnapshot } from "@/plugin/index.js";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { SessionSystemMessage } from "@downcity/agent";
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
  /** 当前 RPC 路由绑定的 Workspace；独立 Agent 模式允许为空。 */
  workspace?: WorkspaceRuntime;
  /** 当前请求对应的 Agent 执行能力。 */
  get_agent_context?: () => RpcAgentContext;
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
  /** 当前 RPC 请求绑定的 Workspace；独立 Agent 模式允许为空。 */
  workspace?: WorkspaceRuntime;
  /** 当前请求对应的 Agent 执行能力。 */
  get_agent_context?: () => RpcAgentContext;
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
 * RPC internal handler 所需的最小 Agent 能力集合。
 *
 * 这是传输层的依赖投影，不是新的领域对象，也不拥有 Agent 或 Session。
 */
export interface RpcAgentContext {
  /** 当前 Agent 实例。 */
  agent: Agent;
  /** 当前请求绑定的 Workspace。 */
  workspace: WorkspaceRuntime;
  /** 当前 Agent 唯一的 Session 集合。 */
  sessions: AgentSessionCollection;
  /** 当前 Agent 在 Workspace 中可用的 Plugin 调用面。 */
  plugins: AgentPluginRuntime;
  /** 读取当前 Agent 的 Plugin 状态。 */
  list_plugin_states: () => PluginSnapshot[];
  /** 解析当前 Session 的 system messages。 */
  resolve_system_messages: (input: {
    /** 目标 Session ID。 */
    session_id: string;
    /** system message profile。 */
    profile?: "chat" | "task";
  }) => Promise<SessionSystemMessage[]>;
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
