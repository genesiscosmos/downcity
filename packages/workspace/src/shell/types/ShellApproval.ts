/**
 * Shell unrestricted 权限审批网关类型。
 *
 * 关键点（中文）
 * - Shell 负责校验命令并等待审批结果，但不拥有 Session 的 pending approval 状态。
 * - 宿主通过单次 Tool 执行上下文注入网关，Shell 不再反向发布未类型化 Session 事件。
 */

import type {
  ShellApprovalStatus,
  ShellApprovalToolName,
} from "@/shell/types/ShellAction.js";

/** Shell 向宿主提交的单次 unrestricted 审批请求。 */
export interface ShellApprovalRequest {
  /** 当前请求关联的 Shell 运行标识。 */
  shell_id: string;
  /** 当前请求关联的 AI SDK Tool Call 标识。 */
  tool_call_id: string;
  /** 当前请求来源工具。 */
  tool_name: ShellApprovalToolName;
  /** 当前请求所属 Agent Session。 */
  session_id: string;
  /** 当前请求所属 Turn。 */
  turn_id: string;
  /** 待执行命令或待写入内容。 */
  command: string;
  /** 当前工具工作目录。 */
  cwd: string;
  /** 请求 unrestricted 权限的原因。 */
  reason: string;
  /** 当前请求对应的 Shell 操作。 */
  operation: "exec" | "start" | "write";
  /** stdin 写入预览，仅 write 操作存在。 */
  input_preview?: string;
  /** stdin 写入字符数，仅 write 操作存在。 */
  input_chars?: number;
  /** 当前请求等待人工决定的最长时间。 */
  timeout_ms: number;
}

/** 宿主创建审批请求后返回给 Shell 的等待句柄。 */
export interface ShellApprovalHandle {
  /** 当前审批请求的稳定标识。 */
  approval_id: string;
  /** 是否真正进入人工审批队列；always-allow 时为 false。 */
  requires_user_decision: boolean;
  /** 最终审批结果；Shell 必须等待该 Promise 后才能继续。 */
  decision: Promise<ShellApprovalStatus>;
}

/** Session 宿主向 Shell 提供的审批能力。 */
export interface ShellApprovalGateway {
  /** 创建一次审批请求并返回可等待的决定句柄。 */
  request(input: ShellApprovalRequest): Promise<ShellApprovalHandle>;
}
