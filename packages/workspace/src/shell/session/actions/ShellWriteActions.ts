/**
 * Shell write action。
 *
 * 关键点（中文）
 * - safe shell 可直接写入 stdin。
 * - unrestricted shell 每次写入都必须带 reason 并完成审批。
 */

import type { ShellHostContext } from "@/shell/types/ShellHostContext.js";
import type { ShellRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";
import type {
  ShellActionResponse,
  ShellApprovalStatus,
  ShellWriteRequest,
} from "@/shell/types/ShellAction.js";
import {
  buildActionResponse,
  isInMemorySession,
  resolveSession,
} from "../ShellActionRuntimeSupport.js";
import {
  requestUnrestrictedApproval,
  validateUnrestrictedRequest,
} from "../../approval/ShellApprovalRuntime.js";
import { buildDeniedWriteApprovalResponse } from "./ShellActionShared.js";

/**
 * 向 shell session 写入 stdin。
 */
export async function writeShellSession(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellWriteRequest,
): Promise<ShellActionResponse> {
  const shellId = String(request.shellId || "").trim();
  const chars = String(request.chars ?? "");
  if (!shellId) throw new Error("shell.write requires shellId");
  const session = await resolveSession(state, context, {
    shellId,
    includeCompleted: true,
  });
  if (!session || !isInMemorySession(session)) {
    throw new Error("shell session is not active in memory");
  }
  if (session.snapshot.status !== "running" && session.snapshot.status !== "starting") {
    throw new Error(`shell session ${shellId} is not running`);
  }
  if (!session.child.writable) {
    throw new Error(`shell session ${shellId} stdin is closed`);
  }
  if (session.snapshot.stdinWritable === false) {
    throw new Error(`shell session ${shellId} stdin is closed`);
  }

  let approvalId: string | undefined;
  let approvalStatus: ShellApprovalStatus | undefined;
  const reason = String(request.reason || "").trim();
  // 关键点（中文）
  // - turnId 由 tool action 显式传入。
  const turnId =
    String(
      request.turnId || "",
    ).trim() || undefined;
  if (session.snapshot.sandboxMode === "unrestricted") {
    const validationError = validateUnrestrictedRequest({ cmd: chars, reason });
    if (validationError) throw new Error(validationError);
    const approval = await requestUnrestrictedApproval({
      context,
      shellId,
      toolName: "shell_write",
      cmd: chars,
      cwd: session.snapshot.cwd,
      reason,
      ...(session.snapshot.ownerContextId ? { ownerContextId: session.snapshot.ownerContextId } : {}),
      ...(turnId ? { turnId } : {}),
      inputPreview: chars,
      inputChars: chars.length,
      ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
      timeoutMs: state.options.defaultApprovalTimeoutMs,
    });
    approvalId = approval.approvalId;
    approvalStatus = approval.status;
    if (approval.status !== "approved") {
      return buildDeniedWriteApprovalResponse({
        session,
        approvalId: approval.approvalId,
        reason,
        approvalStatus: approval.status,
      });
    }
  }
  await session.child.write(chars);
  return buildActionResponse({
    shell: {
      ...session.snapshot,
      ...(approvalStatus ? { approvalStatus } : {}),
      ...(approvalId ? { approvalId } : {}),
      ...(reason ? { approvalReason: reason } : {}),
      stdinWritable: true,
    },
    note: chars ? "stdin written" : "no chars written",
  });
}
