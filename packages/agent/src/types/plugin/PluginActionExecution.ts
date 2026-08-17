/**
 * Plugin Action 单次执行上下文。
 *
 * 关键点（中文）
 * - 每次 Action 调用都获得独立、只读的身份与取消快照。
 * - Agent 与 Workspace 身份由 Plugin Registry 根据当前 PluginContext 写入，调用方不能覆盖。
 * - Session 字段来自可选的 PluginExecutionContext；HTTP、CLI 与 Schedule 调用可以没有 Session。
 */

import type { PluginExecutionContext } from "@/types/plugin/PluginExecutionContext.js";

/** Plugin Action 执行器传给业务 Action 的完整只读上下文。 */
export interface PluginActionExecutionContext extends PluginExecutionContext {
  /** 当前 Action 所属 Agent 的稳定标识。 */
  readonly agent_id: string;

  /** 当前 Action 所属 Workspace 的稳定标识。 */
  readonly workspace_id: string;

  /** 当前 Action 调用的稳定标识；模型 Tool 调用时等于对应 tool call ID。 */
  readonly call_id: string;

  /** 当前 Action 必须监听的取消信号；可同时承载 Turn 取消和 Action 超时。 */
  readonly abort_signal: AbortSignal;
}
