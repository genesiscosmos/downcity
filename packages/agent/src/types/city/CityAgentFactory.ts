/**
 * City 本地 Agent 装配类型。
 *
 * 调用方负责解析 Registry、模型、Plugin 与平台 Sandbox；工厂只组合明确输入，
 * 不依赖宿主环境或持久化实现。
 */

import type { AgentModel } from "@/agent/AgentModel.js";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { ShellSandboxAdapter } from "@downcity/shell";

/** 创建一个本地 City Agent 的完整输入。 */
export interface CreateCityAgentInput {
  /** Agent 稳定 ID。 */
  agent_id: string;

  /** 本次运行使用的 Workspace 绝对路径。 */
  workspace_path: string;

  /** Agent 默认模型实例。 */
  model: AgentModel;

  /** 本次运行启用的 Plugin 实例。 */
  plugins?: Plugin[];

  /** Workspace Shell 使用的平台 Sandbox Adapter。 */
  sandbox: ShellSandboxAdapter;

  /** Workspace 环境变量快照。 */
  env?: Record<string, string>;
}
