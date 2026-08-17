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
} from "@/shell/types/ShellAction.js";
import {
  buildActionResponse,
  nowMs,
} from "../ShellActionRuntimeSupport.js";
import { resolve_default_shell_path } from "../ShellCommandModel.js";

/**
 * 解析默认 shell 路径。
 */
export function resolveDefaultShellPath(): string {
  return resolve_default_shell_path();
}

/**
 * 解析 shell action 请求的 sandbox 模式。
 */
export function resolveSandboxMode(value: unknown): "safe" | "unrestricted" {
  return value === "unrestricted" ? "unrestricted" : "safe";
}

function approvalDeniedMessage(status: ShellApprovalStatus): string {
  return status === "expired"
    ? "Unrestricted sandbox approval expired."
    : "User denied unrestricted sandbox execution.";
}

/**
 * 构造 shell_session / shell_exec 审批未通过时的统一响应。
 */
export function buildDeniedApprovalResponse(params: {
  /**
   * shell session id。
   */
  shellId: string;
  /**
   * 归属的宿主 session id。
   */
  ownerContextId?: string;
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
  shellPath: string;
  /**
   * approval id。
   */
  approvalId: string;
  /**
   * agent 给出的申请原因。
   */
  reason: string;
  /**
   * 审批结果状态。
   */
  approvalStatus: ShellApprovalStatus;
}): ShellActionResponse {
  const now = nowMs();
  const message = approvalDeniedMessage(params.approvalStatus);
  return buildActionResponse({
    shell: {
      shellId: params.shellId,
      ...(params.ownerContextId ? { ownerContextId: params.ownerContextId } : {}),
      cmd: params.cmd,
      cwd: params.cwd,
      shellPath: params.shellPath,
      sandboxed: false,
      sandboxMode: "unrestricted",
      sandboxBackend: "unrestricted-host",
      sandboxNetworkMode: "full",
      approvalStatus: params.approvalStatus,
      approvalId: params.approvalId,
      approvalReason: params.reason,
      stdinWritable: true,
      status: params.approvalStatus === "expired" ? "expired" : "failed",
      startedAt: now,
      updatedAt: now,
      endedAt: now,
      exitCode: -1,
      lastOutputPreview: message,
      outputChars: message.length,
      droppedChars: 0,
      version: 1,
      autoNotifyOnExit: false,
      notificationSent: false,
      externalRefs: [],
    },
    chunk: {
      shellId: params.shellId,
      output: message,
      startCursor: 0,
      endCursor: message.length,
      originalChars: message.length,
      originalLines: 1,
      hasMoreOutput: false,
    },
    note: message,
  });
}

/**
 * 构造 shell_write 审批未通过时的统一响应。
 */
export function buildDeniedWriteApprovalResponse(params: {
  /**
   * 当前 shell session。
   */
  session: ShellSessionRuntimeState;
  /**
   * approval id。
   */
  approvalId: string;
  /**
   * agent 给出的申请原因。
   */
  reason: string;
  /**
   * 审批结果状态。
   */
  approvalStatus: ShellApprovalStatus;
}): ShellActionResponse {
  const message = approvalDeniedMessage(params.approvalStatus);
  return buildActionResponse({
    shell: {
      ...params.session.snapshot,
      approvalStatus: params.approvalStatus,
      approvalId: params.approvalId,
      approvalReason: params.reason,
      stdinWritable: true,
    },
    chunk: {
      shellId: params.session.snapshot.shellId,
      output: message,
      startCursor: 0,
      endCursor: message.length,
      originalChars: message.length,
      originalLines: 1,
      hasMoreOutput: false,
    },
    note: message,
  });
}
