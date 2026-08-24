/**
 * Session tool 显式执行上下文。
 *
 * 关键点（中文）
 * - 该对象由 Executor 在每个 Session step 绑定到 tool.execute。
 * - Agent 工具读取 session_turn_context，Shell 工具只读取 shell_execution_context。
 * - 上下文归属当前 Turn，不通过进程级或异步全局容器共享。
 */

import type {
  ShellExecutionContext,
} from "@downcity/workspace/shell/types/ShellRuntime.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import type { ToolActionExecutionContext } from "@/types/tools/ToolActionExecutionContext.js";

/**
 * Agent 与 Shell 工具共用的单次执行上下文。
 */
export interface SessionToolExecutionContext {
  /** 业务 Tool 读取的最小执行上下文。 */
  action_execution_context: ToolActionExecutionContext;
  /** 当前 Shell Tool 的 canonical 执行上下文。 */
  shell_execution_context: ShellExecutionContext;
  /** 当前工具调用所属的完整 Session Turn 上下文。 */
  session_turn_context: SessionTurnContext;
}
