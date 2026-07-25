/**
 * Plugin command 与 lifecycle 类型。
 *
 * 关键点（中文）
 * - command 面向显式 CLI/control 调用。
 * - lifecycle 面向 runtime 主动 start/stop 钩子。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { JsonValue } from "@/types/common/Json.js";

/**
 * Plugin 命令执行上下文。
 *
 * 关键点（中文）
 * - 这里表达的是“CLI 命令执行 plugin 时真正需要的最小上下文”。
 * - plugin 命令不应依赖 session、plugin invoke、agent runtime 等长期宿主对象。
 * - agent runtime 在需要复用 action 时，直接传入自身更完整的 PluginContext 即可。
 */
export interface PluginCommandContext {
  /** 当前 Agent 稳定标识。 */
  agent_id: string;
  /** 当前项目根目录。 */
  workspace_path: string;
  /** 当前统一日志器。 */
  logger: Logger;
  /**
   * 当前项目环境变量快照。
   *
   * 关键点（中文）
   * - 这里约定为宿主已经整理好的最终可见 workspace_env 视图。
   * - plugin 不再区分 global workspace_env 与 agent workspace_env，避免上下文语义膨胀。
   */
  workspace_env: Record<string, string>;
}

/**
 * Plugin 非 action 命令执行参数。
 */
export interface PluginCommandParams {
  /** 当前统一执行上下文。 */
  context: PluginContext;
  /** 当前命令名称。 */
  command: string;
  /** 命令附带 payload（可选）。 */
  payload?: JsonValue;
}

/**
 * Plugin 非 action 命令执行结果。
 */
export interface PluginCommandResult {
  /** 本次命令是否成功。 */
  success: boolean;
  /** 人类可读消息。 */
  message?: string;
  /** 结构化返回数据。 */
  data?: JsonValue;
}

/**
 * Plugin 生命周期定义。
 *
 * 关键点（中文）
 * - 生命周期只描述 plugin 启动、停止和非 action 命令处理。
 */
export interface PluginLifecycle {
  /** plugin 启动钩子。 */
  start?(context: PluginContext): Promise<void> | void;
  /** plugin 停止钩子。 */
  stop?(context: PluginContext): Promise<void> | void;
  /** plugin 非 action 命令钩子。 */
  command?(
    params: PluginCommandParams,
  ): Promise<PluginCommandResult> | PluginCommandResult;
}
