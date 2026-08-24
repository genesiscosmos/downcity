/**
 * Plugin Action 单次执行上下文。
 *
 * 关键点（中文）
 * - 每次 Action 调用都获得独立、只读的身份与取消快照。
 * - Agent 与 Workspace 的稳定身份只保留在 PluginContext，不复制到单次执行对象。
 * - Session 字段来自可选的 PluginExecutionContext；HTTP、CLI 与 Schedule 调用可以没有 Session。
 */

import type { PluginExecutionContext } from "@/types/plugin/PluginExecutionContext.js";
import type { SessionInteractionPort } from "@/types/session/SessionInteraction.js";

/** 当前 Action 所属 Session 的执行范围。 */
export interface PluginSessionExecutionScope {
  /** 当前 Session 标识。 */
  readonly session_id: string;
  /** 当前 Turn 标识。 */
  readonly turn_id: string;
  /** 当前 Session 的用户交互端口；当前入口未开放交互能力时为空。 */
  readonly interactions?: SessionInteractionPort;
}

/** Plugin Action 执行器传给业务 Action 的完整只读上下文。 */
export interface PluginActionExecutionContext {
  /** 当前 Action 调用的稳定标识；模型 Tool 调用时等于对应 tool call ID。 */
  readonly call_id: string;

  /** 当前 Action 必须监听的取消信号；可同时承载 Turn 取消和 Action 超时。 */
  readonly abort_signal: AbortSignal;

  /** 当前调用所属的 Session；非 Session 入口时为空。 */
  readonly session?: PluginSessionExecutionScope;

  /** 当前调用开始时捕获的只读 Step 快照。 */
  readonly snapshot: PluginExecutionContext;
}
