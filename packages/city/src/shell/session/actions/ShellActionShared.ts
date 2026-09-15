/**
 * Shell action 共享辅助函数。
 *
 * 关键点（中文）
 * - 这里只放多个 action 都需要的轻量逻辑。
 * - 不承载具体 action 编排，避免重新形成巨型模块。
 */

import type { ShellSessionRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";
import type {
  ShellActionResponse,
  ShellApprovalStatus,
} from "@downcity/type/shell";
import {
  build_action_response,
  now_ms,
} from "../ShellActionRuntimeSupport.js";
import {
  resolve_default_shell_path as resolve_platform_default_shell_path,
} from "../ShellCommandModel.js";

/**
 * 解析默认 shell 路径。
 */
export function resolve_default_shell_path(): string {
  return resolve_platform_default_shell_path();
}

/**
 * 解析 Shell action 请求的执行目标。
 */
export function resolve_execution_target(value: unknown): "sandbox" | "host" {
  return value === "host" ? "host" : "sandbox";
}

function approval_denied_message(): string {
  return "User denied host execution.";
}

/**
 * 构造 shell_session / shell_exec 审批未通过时的统一响应。
 */
export function build_denied_approval_response(params: {
  /**
   * shell session id。
   */
  shell_id: string;
  /**
   * 归属的宿主 session id。
   */
  owner_context_id?: string;
  /**
   * 请求执行的命令。
   */
  cmd: string;
  /**
   * 请求执行目录。
   */
  cwd: string;
  /**
   * shell 程序路径。
   */
  shell_path: string;
  /**
   * approval id。
   */
  approval_id: string;
  /**
   * agent 给出的申请原因。
   */
  reason: string;
  /**
   * 审批结果状态。
   */
  approval_status: ShellApprovalStatus;
}): ShellActionResponse {
  const now = now_ms();
  const message = approval_denied_message();
  return build_action_response({
    shell: {
      shell_id: params.shell_id,
      ...(params.owner_context_id ? { owner_context_id: params.owner_context_id } : {}),
      cmd: params.cmd,
      cwd: params.cwd,
      shell_path: params.shell_path,
      target: "host",
      execution_backend: "host",
      approval_status: params.approval_status,
      approval_id: params.approval_id,
      approval_reason: params.reason,
      stdin_writable: true,
      status: "failed",
      started_at: now,
      updated_at: now,
      ended_at: now,
      exit_code: -1,
      last_output_preview: message,
      output_chars: message.length,
      dropped_chars: 0,
      version: 1,
      auto_notify_on_exit: false,
      notification_sent: false,
      external_refs: [],
    },
    chunk: {
      shell_id: params.shell_id,
      output: message,
      start_cursor: 0,
      end_cursor: message.length,
      original_chars: message.length,
      original_lines: 1,
      has_more_output: false,
    },
    note: message,
  });
}

/**
 * 构造 shell_write 审批未通过时的统一响应。
 */
export function build_denied_write_approval_response(params: {
  /**
   * 当前 shell session。
   */
  session: ShellSessionRuntimeState;
  /**
   * approval id。
   */
  approval_id: string;
  /**
   * agent 给出的申请原因。
   */
  reason: string;
  /**
   * 审批结果状态。
   */
  approval_status: ShellApprovalStatus;
}): ShellActionResponse {
  const message = approval_denied_message();
  return build_action_response({
    shell: {
      ...params.session.snapshot,
      approval_status: params.approval_status,
      approval_id: params.approval_id,
      approval_reason: params.reason,
      stdin_writable: true,
    },
    chunk: {
      shell_id: params.session.snapshot.shell_id,
      output: message,
      start_cursor: 0,
      end_cursor: message.length,
      original_chars: message.length,
      original_lines: 1,
      has_more_output: false,
    },
    note: message,
  });
}
