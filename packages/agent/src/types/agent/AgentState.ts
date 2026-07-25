/**
 * AgentState 内部装配参数。
 *
 * 职责说明（中文）
 * - 只描述 AgentState 连接 PluginRegistry、Session 与 tools 所需的稳定引用。
 * - 这些对象都由 Agent 先完成创建，AgentState 只负责运行时连接和生命周期。
 */

import type { Tool } from "ai";
import type { AgentSessions } from "@/agent/AgentSessions.js";
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

  /** 当前 Agent 唯一的 Session 集合。 */
  sessions: AgentSessions;

  /** 当前 Agent 与 Session 共享的可变工具集合。 */
  tools: Record<string, Tool>;

}
