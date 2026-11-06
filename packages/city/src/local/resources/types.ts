/** 本机资源用例的装配依赖；CLI 和 Desktop 注入自身模型、Workspace 与展示失效适配。 */
import type { Agent } from "@downcity/agent";
import type { ModelClient } from "@downcity/type";
import type { City } from "../../city/runtime/City.js";
import type { LocalAgentConfig, LocalWorkspaceConfig } from "../types/LocalConfig.js";
import type { AgentRepository } from "../repositories/AgentRepository.js";
import type { WorkspaceRepository } from "../repositories/WorkspaceRepository.js";
import type { ResourceCoordinator } from "./ResourceCoordinator.js";

/** 宿主注入；不存在时只允许配置与历史操作。 */
export interface ResourceHost {
  /** 唯一运行资源容器。 */
  city: City;
  /** 用宿主自己的产品配置装配 Agent，不恢复 Session。 */
  create_agent: (config: LocalAgentConfig) => Promise<Agent>;
  /** 在保存前解析模型；无模型返回 undefined。 */
  resolve_model: (model_id: string | undefined, config?: LocalAgentConfig) => Promise<ModelClient | undefined>;
  /** 获取或懒装配已登记 Workspace；调用方先检查门禁。 */
  resolve_workspace: (config: LocalWorkspaceConfig) => Promise<import("@downcity/type").WorkspaceRuntime>;
  /** 活跃 Shell 等不在 Session actor 中的工作预检。 */
  assert_workspace_idle: (workspace_id: string) => Promise<void>;
  /** Workspace 预检成功后、释放之前注销宿主订阅，保留所有持久化快照/覆盖。 */
  release_workspace?: (workspace_id: string) => void | Promise<void>;
  /** 释放 Agent 私有 main Workspace 和宿主订阅，不能停止工作。 */
  release_agent: (agent_id: string) => Promise<void>;
  /** 产品视图失效；在实际提交之后通知。 */
  invalidate: () => void;
}

/** 持有 root 租约的同一组业务依赖。 */
export interface ResourceDependencies {
  /** 已经规范化并验证身份的 root。 */
  root_path: string;
  /** Agent 唯一配置仓储。 */
  agents: AgentRepository;
  /** 无 DB 的空 root 用 null；任何创建请求由写适配先打开 DB。 */
  workspaces: WorkspaceRepository | null;
  /** root 生命周期级协调器，与懒解析入口共享。 */
  coordinator: ResourceCoordinator;
  /** 在线宿主；离线只读不能装配该对象。 */
  host?: ResourceHost;
  /** 持有离线共享租约，只读 SQLite 使用 immutable 模式。 */
  immutable: boolean;
  /** 强引用预检；返回公开地址摘要，不能返回 Power 私密配置。 */
  agent_references: (agent_id: string) => Promise<Record<string, unknown>[]>;
}
