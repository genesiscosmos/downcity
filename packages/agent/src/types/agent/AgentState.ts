/**
 * AgentState 内部装配参数。
 *
 * 职责说明（中文）
 * - 只描述 AgentState 启动 PluginRegistry 长期运行时所需的稳定引用。
 * - 工具注册与 Session 同步由 Agent 负责，AgentState 只负责生命周期。
 */

import type { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type { AgentContext } from "@/agent/AgentContext.js";

/**
 * AgentState 构造参数。
 */
export interface AgentStateOptions {
  /** 当前 Agent 共用的执行上下文。 */
  context: AgentContext;

  /** 当前 Agent 唯一的 PluginRegistry 实例。 */
  plugins: PluginRegistry;

}
