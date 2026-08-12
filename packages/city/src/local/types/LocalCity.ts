/**
 * LocalCityStore 对外配置类型。
 *
 * 这些类型描述本地 Store 的稳定输入和管理视图，不暴露数据库行、密文或连接细节。
 */

import type { AgentDefinition, AgentPluginDefinition, JsonObject } from "@downcity/agent";

/** 本地 City Store 构造参数。 */
export interface LocalCityStoreOptions {
  /** Downcity 用户级数据根目录；默认使用 `~/.downcity`。 */
  root_path?: string;

  /** 当前宿主需要恢复的 Agent ID；省略时恢复 Store 中的全部 Agent。 */
  agent_ids?: readonly string[];

  /** 当前宿主提供 Agent HTTP 能力时使用的监听地址。 */
  host?: string;

  /** 当前宿主提供 Agent HTTP 能力时使用的监听端口。 */
  port?: number;
}

/** 本地 Workspace 的持久化配置。 */
export interface LocalWorkspaceConfig {
  /** Workspace 的全局稳定 ID。 */
  workspace_id: string;

  /** Workspace 当前指向的真实绝对目录。 */
  workspace_path: string;

  /** Workspace 的用户可见名称。 */
  name: string;

  /** 首次登记时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 本地 Agent 的持久化管理视图。 */
export interface LocalAgentConfig extends Omit<AgentDefinition, "workspace_id"> {
  /** Agent 的全局稳定 ID。 */
  agent_id: string;

  /** 当前 Agent 对应的 Workspace；历史未绑定记录暂时为空。 */
  workspace_id?: string;

  /** 首次注册时间，使用 ISO 8601 字符串。 */
  created_at: string;

  /** 最近更新时间，使用 ISO 8601 字符串。 */
  updated_at: string;
}

/** 创建一个尚未注册的本地 Agent 所需配置。 */
export interface NewLocalAgentInput {
  /** Agent 的全局稳定 ID。 */
  agent_id: string;

  /** Agent 唯一对应的 Workspace 稳定 ID。 */
  workspace_id: string;

  /** Workspace 当前指向的本地目录。 */
  workspace_path: string;

  /** 可选 Workspace 展示名称。 */
  workspace_name?: string;

  /** 默认模型执行配置。 */
  execution?: JsonObject;

  /** LLM 行为配置。 */
  llm?: JsonObject;

  /** 当前 Agent 的全部 Plugin 绑定。 */
  plugins?: readonly AgentPluginDefinition[];

  /** Agent 配置协议版本。 */
  version?: string;
}
