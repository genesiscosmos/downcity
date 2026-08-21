/**
 * City 生命周期类型。
 *
 * City 只维护 Agent 的内存索引与 transport，不表达持久化或 Agent 生命周期。
 */

import type { CityHttpRuntimeOptions } from "@/transport/types/CityHttpRuntime.js";
import type { CityRpcRuntimeOptions } from "@/transport/types/CityRpcRuntime.js";
import type { Agent } from "@downcity/agent";
import type { Embassy } from "@downcity/federation";
import type { WorkspaceBase } from "@downcity/workspace";

/** City 的资源容器构造参数。 */
export interface CityOptions {
  /** City 使用的 Federation Embassy；Plugin 只通过窄服务借用其能力。 */
  embassy?: Embassy;

  /** City 持有的 Workspace 资源集合；每个 Workspace ID 必须唯一。 */
  workspaces?: readonly WorkspaceBase[];

  /** HTTP/RPC transport 与宿主扩展配置；仅供宿主装配层使用。 */
  runtime?: CityRuntimeOptions;
}

/** City 构造时可注入的 transport 扩展能力。 */
export interface CityRuntimeOptions {
  /** 按需为 Agent 创建指定 Workspace；City 不读取任何持久化配置。 */
  resolve_workspace?: (
    agent: Agent,
    workspace_id: string,
  ) => WorkspaceBase | Promise<WorkspaceBase>;

  /** HTTP transport 的模型解析和宿主扩展路由。 */
  http?: CityHttpRuntimeOptions;

  /** RPC transport 的模型解析与环境刷新能力。 */
  rpc?: CityRpcRuntimeOptions;
}

/** Agent 绑定 City 时所需的最小宿主协议。 */
export interface CityAgentBinding {
  /** 绑定一个 Agent；重复 ID 必须失败。 */
  bind_agent(agent: Agent): void;
  /** 解除一个 Agent 的运行时引用。 */
  unbind_agent(agent: Agent): void;
  /** 按 ID 返回 City 持有的 Workspace。 */
  workspace(workspace_id: string): WorkspaceBase | null;
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
