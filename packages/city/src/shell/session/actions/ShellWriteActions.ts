/**
 * Shell write action。
 *
 * 关键点（中文）
 * - Sandbox Shell 可直接写入 stdin。
 * - Host Shell 每次写入都必须带 reason 并完成审批。
 */

import type { PrivateShellHostContext } from "../ShellPrivateValues.js";
import { create_shell_output_redactor, SHELL_REDACTION_ERROR } from "../ShellPrivateValues.js";
import { redact_public_value } from "@/power/core/PowerPrivateValues.js";
import type { ShellRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";
import type {
  ShellActionResponse,
  ShellApprovalStatus,
  ShellWriteRequest,
} from "@downcity/type/shell";
import {
  append_session_output,
  build_action_response,
  is_in_memory_session,
  resolve_session,
} from "../ShellActionRuntimeSupport.js";
import {
  request_host_approval,
  validate_host_request,
} from "../../approval/HostApprovalRuntime.js";
import { build_denied_write_approval_response } from "./ShellActionShared.js";

/**
 * 向 shell session 写入 stdin。
 */
export async function write_shell_session(
  state: ShellRuntimeState,
  context: PrivateShellHostContext,
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

  // Keep one Session's live registry attached for the process lifetime. A
  // different Session must not inject private stdin into an unrelated registry.
  if ((session.private_values || context.private_values)
    && (!request.owner_context_id || request.owner_context_id !== session.snapshot.owner_context_id)) {
    throw new Error("Private Shell stdin must come from the Session that started the process.");
  }
  if (!session.private_values && context.private_values) {
    session.output_redactor = create_shell_output_redactor(context.private_values);
    session.private_values = context.private_values;
  }

  // Refresh both stream stages against newly submitted values before any
  // approval wait or stdin echo. Streams retain that snapshot after Session clear.
  await append_session_output(state, session, "");
  if (session.output_redaction_failed) throw new Error(SHELL_REDACTION_ERROR);

  let approval_id: string | undefined;
  let approval_status: ShellApprovalStatus | undefined;
  const reason = String(request.reason || "").trim();
  const public_reason = redact_public_value(reason, context.private_values);
  // 关键点（中文）
  // - turn_id 由 tool action 显式传入。
  const turn_id =
    String(
      request.turn_id || "",
    ).trim() || undefined;
  if (session.snapshot.target === "host") {
    const validation_error = validate_host_request({ cmd: chars, reason });
    if (validation_error) throw new Error(validation_error);
    const approval = await request_host_approval({
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
    });
    approval_id = approval.approval_id;
    approval_status = approval.status;
    if (approval.status !== "approved") {
      return build_denied_write_approval_response({
        session,
        approval_id: approval.approval_id,
        reason: public_reason,
        approval_status: approval.status,
      });
    }
  }
  // Approval can outlive the originating Session. Never publish a process
  // handle's exception that could embed the submitted stdin after store clear.
  try {
    await session.child.write(chars);
  } catch {
    throw new Error("Shell stdin write failed.");
  }
  return build_action_response({
    shell: {
      ...session.snapshot,
      ...(approval_status ? { approval_status } : {}),
      ...(approval_id ? { approval_id } : {}),
      ...(reason ? { approval_reason: public_reason } : {}),
      stdin_writable: true,
    },
    note: chars ? "stdin written" : "no chars written",
  });
}
