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
  /** 保留宿主已有明确 Session 模型覆盖；只在在线执行准备时应用。 */
  prepare_session?: (agent_id: string, session: import("@downcity/agent").AgentSession) => Promise<void>;
  /** 活跃 Shell 等不在 Session actor 中的工作预检。 */
  assert_workspace_idle: (workspace_id: string) => Promise<void>;
  /** Workspace 预检成功后、释放之前注销宿主订阅，保留所有持久化快照/覆盖。 */
  release_workspace?: (workspace_id: string) => void | Promise<void>;
  /** 释放 Agent 私有 main Workspace 和宿主订阅，不能停止工作。 */
  release_agent: (agent_id: string) => Promise<void>;
  /** 按宿主既有进程环境优先级重载 Workspace Env，不统一覆盖各产品身份边界。 */
  refresh_env?: (workspace_id?: string) => Promise<void>;
  /** 产品视图失效；在实际提交之后通知。 */
  invalidate: () => void;
}

/** 持有 root 租约的同一组业务依赖。 */
export interface ResourceDependencies {
  /** 宿主已装配的共享扩展用例，离线普通资源浏览可省略。 */
  extensions?: import("../extensions/ExtensionPlatform.js").ExtensionPlatform;
  /** 离线显式模型选择使用的 Town resolver，不装配 Agent 或启动宿主。 */
  resolve_model?: (model_id: string) => Promise<ModelClient>;
  /** 已经规范化并验证身份的 root。 */
  root_path: string;
  /** Agent 唯一配置仓储。 */
  agents: AgentRepository;
  /** owner 已装配的 Town 管理入口；缺失能力时拒绝跨进程命令，不绕过 owner 写仓储。 */
  town?: import("./ManagementChannel.js").ResourceDispatcher;
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
