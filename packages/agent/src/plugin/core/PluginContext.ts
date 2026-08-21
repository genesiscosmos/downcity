/**
 * PluginContext 工厂：构造 Agent 向 Plugin 投影的只读能力视图。
 *
 * 关键点（中文）
 * - 固定能力直接引用唯一实例。
 * - env 与 instruction 使用 getter 延迟读取，避免复制可变状态。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";

/** PluginContext 工厂输入。 */
export interface CreatePluginContextInput {
  /** 当前 Agent 稳定标识。 */
  agent_id: PluginContext["agent_id"];
  /** 当前 Workspace 稳定标识。 */
  workspace_id: PluginContext["workspace_id"];
  /** 当前 Workspace 绝对根目录。 */
  workspace_path: PluginContext["workspace_path"];
  /** 当前 Plugin 在 Agent 内的运行时数据根路径。 */
  data_path: PluginContext["data_path"];
  /** 当前 Workspace 文件能力。 */
  files: PluginContext["files"];
  /** 当前 Plugin 运行时私有数据目录的文件能力。 */
  data_files: PluginContext["data_files"];
  /** 当前 Workspace 可选 Shell。 */
  shell?: PluginContext["shell"];
  /** 当前 Agent 日志器。 */
  logger: PluginContext["logger"];
  /** 当前 Agent 的 Web 搜索与文档能力。 */
  web?: PluginContext["web"];
  /** 延迟读取当前 AgentWorkspace Session 集合。 */
  get_sessions: () => PluginContext["sessions"];
  /** 延迟读取当前 AgentWorkspace 的 Plugin 注册表视图。 */
  get_plugins: () => PluginContext["plugins"];
  /** 延迟读取 Workspace env。 */
  get_workspace_env: () => PluginContext["workspace_env"];
  /** 延迟读取 Agent instruction。 */
  get_instructions: () => PluginContext["instructions"];
}

/** 创建一个不复制动态状态的 PluginContext。 */
export function create_plugin_context(
  input: CreatePluginContextInput,
): PluginContext {
  return Object.freeze({
    agent_id: input.agent_id,
    workspace_id: input.workspace_id,
    workspace_path: input.workspace_path,
    data_path: input.data_path,
    files: input.files,
    data_files: input.data_files,
    ...(input.shell ? { shell: input.shell } : {}),
    logger: input.logger,
    ...(input.web ? { web: input.web } : {}),
    get sessions() {
      return input.get_sessions();
    },
    get plugins() {
      return input.get_plugins();
    },
    get workspace_env() {
      return input.get_workspace_env();
    },
    get instructions() {
      return input.get_instructions();
    },
  });
}
