/**
 * City 生命周期类型。
 *
 * City 维护 Agent 集合与 transport，并协调已加入 Agent 的运行时生命周期。
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

/** City 管理的 Agent 集合。 */
export interface CityAgents {
  /**
   * 添加一个已经实例化的 Agent，并建立它与当前 City 的资源绑定。
   * 重复 Agent ID 或已属于其他 City 时必须失败。
   */
  add(agent: Agent): Agent;
  /** 按稳定 ID 获取 Agent；不存在或正在移除时返回 null。 */
  get(agent_id: string): Agent | null;
  /** 返回当前 City 管理的 Agent 稳定快照。 */
  list(): readonly Agent[];
  /** 停止、释放并移除 Agent；不存在时返回 null。 */
  remove(agent_id: string): Promise<Agent | null>;
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
