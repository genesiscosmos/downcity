/**
 * Shell start action。
 *
 * 关键点（中文）
 * - 负责创建 shell session、发起 host 审批、启动子进程并返回初始输出。
 * - 长轮询与读取逻辑仍由 query actions 提供。
 */

import fs from "fs-extra";
import type { ShellHostContext } from "@downcity/type/shell";
import { spawn_shell_process } from "@/shell/sandbox/Sandbox.js";
import type {
  ShellRuntimeState,
  ShellSessionRuntimeState,
  ShellSessionWaiter,
} from "@/shell/session/ShellRuntimeTypes.js";
import { generate_id } from "@/utils/Id.js";
import type {
  ShellActionResponse,
  ShellApprovalStatus,
  ShellStartRequest,
} from "@downcity/type/shell";
import { get_shell_dir, get_shell_output_path, get_shell_snapshot_path } from "../Paths.js";
import {
  build_action_response,
  build_shell_env,
  clamp_wait_ms_with_options,
  create_output_chunk,
  ensure_capacity,
  is_in_memory_session,
  persist_snapshot,
  resolve_session,
  resolve_shell_cwd,
} from "../ShellActionRuntimeSupport.js";
import { attach_shell_process_event_handlers } from "../ShellProcessEvents.js";
import {
  request_host_approval,
  validate_host_request,
} from "../../approval/HostApprovalRuntime.js";
import {
  build_denied_approval_response,
  resolve_default_shell_path,
  resolve_execution_target,
} from "./ShellActionShared.js";
import { bind_shell_runtime } from "./ShellLifecycleActions.js";
import { wait_shell_session } from "./ShellQueryActions.js";

/**
 * 启动一个 shell session。
 */
export async function start_shell_session(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellStartRequest,
): Promise<ShellActionResponse> {
  const cmd = String(request.cmd || "").trim();
  if (!cmd) throw new Error("shell.start requires a non-empty cmd");
  ensure_capacity(state);
  bind_shell_runtime(state, context);

  const shell_id = `sh_${generate_id()}`;
  const cwd = resolve_shell_cwd(context, request.cwd);
  const target = resolve_execution_target(request.target);
  const default_shell_path = target === "host" ? resolve_default_shell_path() : "/bin/sh";
  const shell_path = String(request.shell || default_shell_path).trim() || default_shell_path;
  const login = request.login !== false;
  const reason = String(request.reason || "").trim();
  // 关键点（中文）
  // - owner_context_id/turn_id 由 tool action 显式传入。
  const owner_context_id =
    String(
      request.owner_context_id || "",
    ).trim() || undefined;
  const turn_id =
    String(
      request.turn_id || "",
    ).trim() || undefined;
  const shell_dir = get_shell_dir(context.data_path, shell_id);
  const snapshot_file_path = get_shell_snapshot_path(context.data_path, shell_id);
  const output_file_path = get_shell_output_path(context.data_path, shell_id);

  await fs.ensureDir(shell_dir);
  await fs.writeFile(output_file_path, "", "utf-8");

  let approval_id: string | undefined;
  let approval_status: ShellApprovalStatus | undefined;
  if (target === "host") {
    const validation_error = validate_host_request({ cmd, reason });
    if (validation_error) throw new Error(validation_error);
    const approval = await request_host_approval({
      context,
      shell_id,
      tool_name: request.approval_tool_name || "shell_session",
      cmd,
      cwd,
      reason,
      ...(owner_context_id ? { owner_context_id } : {}),
      ...(turn_id ? { turn_id } : {}),
      ...(request.tool_call_id ? { tool_call_id: request.tool_call_id } : {}),
    });
    approval_id = approval.approval_id;
    approval_status = approval.status;
    if (approval.status !== "approved") {
      return build_denied_approval_response({
        shell_id,
        ...(owner_context_id ? { owner_context_id } : {}),
        cmd,
        cwd,
        shell_path,
        approval_id: approval.approval_id,
        reason,
        approval_status: approval.status,
      });
    }
  }

  const spawn_result = await spawn_shell_process({
    context,
    execution_id: shell_id,
    execution_dir: shell_dir,
    cmd,
    cwd,
    shell_path: shell_path,
    login,
    env: build_shell_env(context, owner_context_id, target),
    target,
    terminal: request.terminal !== false,
    cols: request.cols,
    rows: request.rows,
  });
  const child = spawn_result.child;
  const actual_cwd = spawn_result.cwd;

  const started_at = Date.now();
  let resolve_completion: () => void = () => {};
  const completion_promise = new Promise<void>((resolve) => {
    resolve_completion = resolve;
  });
  const session: ShellSessionRuntimeState = {
    snapshot: {
      shell_id,
      ...(owner_context_id ? { owner_context_id } : {}),
      cmd,
      cwd: actual_cwd,
      shell_path,
      target,
      execution_backend: spawn_result.backend,
      ...(spawn_result.sandbox_id ? { sandbox_id: spawn_result.sandbox_id } : {}),
      ...(approval_status ? { approval_status } : {}),
      ...(approval_id ? { approval_id } : {}),
      ...(reason ? { approval_reason: reason } : {}),
      stdin_writable: true,
      terminal: request.terminal !== false,
      ...(typeof request.cols === "number" ? { cols: request.cols } : {}),
      ...(typeof request.rows === "number" ? { rows: request.rows } : {}),
      status: "running",
      ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
      started_at,
      updated_at: started_at,
      output_chars: 0,
      dropped_chars: 0,
      version: 1,
      auto_notify_on_exit: request.auto_notify_on_exit === true,
      notification_sent: false,
      external_refs: [],
    },
    child,
    output_text: "",
    output_file_path,
    snapshot_file_path,
    write_chain: Promise.resolve(),
    cleanup_timer: null,
    waiters: new Set<ShellSessionWaiter>(),
    completion_promise,
    resolve_completion,
  };
  state.sessions.set(shell_id, session);

  // 关键点（中文）：监听器必须先挂上，避免瞬时命令在 snapshot 持久化期间退出而丢失 close 事件。
  attach_shell_process_event_handlers({ state, session });
  await persist_snapshot(session);

  const inline_wait_ms = clamp_wait_ms_with_options(
    state.options,
    request.inline_wait_ms,
    state.options.default_inline_wait_ms,
  );
  await wait_shell_session(state, context, {
    shell_id,
    after_version: 1,
    from_cursor: 0,
    timeout_ms: inline_wait_ms,
    max_output_tokens: request.max_output_tokens,
  }).catch(() => undefined);

  const latest = await resolve_session(state, context, { shell_id, include_completed: true });
  if (!latest) {
    throw new Error(`shell session disappeared unexpectedly: ${shell_id}`);
  }
  if (
    is_in_memory_session(latest) &&
    latest.snapshot.status === "running" &&
    latest.snapshot.auto_notify_on_exit === false &&
    request.auto_notify_on_exit !== false &&
    Boolean(owner_context_id)
  ) {
    latest.snapshot.auto_notify_on_exit = true;
    await persist_snapshot(latest);
  }
  const chunk = create_output_chunk({
    shell_id,
    output_text: latest.output_text,
    from_cursor: 0,
    context,
    max_output_tokens: request.max_output_tokens,
  });
  return build_action_response({
    shell: latest.snapshot,
    chunk,
    note:
      latest.snapshot.status === "running"
        ? "shell started and is still running"
        : "shell finished during inline wait",
  });
}
