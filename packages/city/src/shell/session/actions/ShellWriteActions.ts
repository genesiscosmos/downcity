/**
 * Shell write action。
 *
 * 关键点（中文）
 * - safe shell 可直接写入 stdin。
 * - unrestricted shell 每次写入都必须带 reason 并完成审批。
 */

import type { ShellHostContext } from "@downcity/type/shell";
import type { ShellRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";
import type {
  ShellActionResponse,
  ShellApprovalStatus,
  ShellWriteRequest,
} from "@downcity/type/shell";
import {
  build_action_response,
  is_in_memory_session,
  resolve_session,
} from "../ShellActionRuntimeSupport.js";
import {
  request_unrestricted_approval,
  validate_unrestricted_request,
} from "../../approval/ShellApprovalRuntime.js";
import { build_denied_write_approval_response } from "./ShellActionShared.js";

/**
 * 向 shell session 写入 stdin。
 */
export async function write_shell_session(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellWriteRequest,
): Promise<ShellActionResponse> {
  const shell_id = String(request.shell_id || "").trim();
  const chars = String(request.chars ?? "");
  if (!shell_id) throw new Error("shell.write requires shell_id");
  const session = await resolve_session(state, context, {
    shell_id,
    include_completed: true,
  });
  if (!session || !is_in_memory_session(session)) {
    throw new Error("shell session is not active in memory");
  }
  if (session.snapshot.status !== "running" && session.snapshot.status !== "starting") {
    throw new Error(`shell session ${shell_id} is not running`);
  }
  if (!session.child.writable) {
    throw new Error(`shell session ${shell_id} stdin is closed`);
  }
  if (session.snapshot.stdin_writable === false) {
    throw new Error(`shell session ${shell_id} stdin is closed`);
  }

  let approval_id: string | undefined;
  let approval_status: ShellApprovalStatus | undefined;
  const reason = String(request.reason || "").trim();
  // 关键点（中文）
  // - turn_id 由 tool action 显式传入。
  const turn_id =
    String(
      request.turn_id || "",
    ).trim() || undefined;
  if (session.snapshot.sandbox_mode === "unrestricted") {
    const validation_error = validate_unrestricted_request({ cmd: chars, reason });
    if (validation_error) throw new Error(validation_error);
    const approval = await request_unrestricted_approval({
      context,
      shell_id,
      tool_name: "shell_write",
      cmd: chars,
      cwd: session.snapshot.cwd,
      reason,
      ...(session.snapshot.owner_context_id ? { owner_context_id: session.snapshot.owner_context_id } : {}),
      ...(turn_id ? { turn_id } : {}),
      input_preview: chars,
      input_chars: chars.length,
      ...(request.tool_call_id ? { tool_call_id: request.tool_call_id } : {}),
      timeout_ms: state.options.default_approval_timeout_ms,
    });
    approval_id = approval.approval_id;
    approval_status = approval.status;
    if (approval.status !== "approved") {
      return build_denied_write_approval_response({
        session,
        approval_id: approval.approval_id,
        reason,
        approval_status: approval.status,
      });
    }
  }
  await session.child.write(chars);
  return build_action_response({
    shell: {
      ...session.snapshot,
      ...(approval_status ? { approval_status } : {}),
      ...(approval_id ? { approval_id } : {}),
      ...(reason ? { approval_reason: reason } : {}),
      stdin_writable: true,
    },
    note: chars ? "stdin written" : "no chars written",
  });
}
