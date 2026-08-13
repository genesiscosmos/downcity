/**
 * AgentRuntime 内部装配参数。
 *
 * 职责说明（中文）
 * - 只描述 AgentRuntime 初始化 PluginRegistry 长期资源所需的稳定引用。
 * - 工具注册与 Session 同步由 Agent 负责，AgentRuntime 只负责资源生命周期。
 */

import type { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";

/**
 * AgentRuntime 构造参数。
 */
export interface AgentRuntimeOptions {
  /** 当前 Agent 共用的执行上下文。 */
  context: PluginContext;

  /** 当前 Agent 唯一的 PluginRegistry 实例。 */
  plugins: PluginRegistry;

}
