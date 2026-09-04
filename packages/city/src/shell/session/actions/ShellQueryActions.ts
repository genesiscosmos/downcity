/**
 * Shell query/read/wait/close actions。
 *
 * 关键点（中文）
 * - 聚合不创建新进程的 session 操作。
 * - close 只负责单个 session，runtime shutdown 使用 lifecycle action。
 */

import type { ShellHostContext } from "@downcity/type/shell";
import type {
  ShellRuntimeState,
  ShellSessionWaiter,
} from "@/shell/session/ShellRuntimeTypes.js";
import type {
  ShellActionResponse,
  ShellCloseRequest,
  ShellListRequest,
  ShellQueryRequest,
  ShellReadRequest,
  ShellWaitRequest,
} from "@downcity/type/shell";
import {
  build_action_response,
  clamp_wait_ms_with_options,
  create_output_chunk,
  is_in_memory_session,
  is_terminal_status,
  resolve_owner_context_id,
  resolve_session,
  schedule_cleanup,
} from "../ShellActionRuntimeSupport.js";
import { terminate_shell_session_process } from "../ShellProcessLifecycle.js";

/**
 * 列出当前 runtime 内的 shell sessions。
 */
export async function list_shell_sessions(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellListRequest,
): Promise<ShellActionResponse> {
  const owner_context_id = resolve_owner_context_id(context, request.owner_context_id);
  const include_completed = request.include_completed !== false;
  const sessions = Array.from(state.sessions.values())
    .map((item) => item.snapshot)
    .filter((snapshot) => {
      if (owner_context_id && snapshot.owner_context_id !== owner_context_id) return false;
      if (include_completed) return true;
      return snapshot.status === "running" || snapshot.status === "starting";
    })
    .sort((left, right) => right.updated_at - left.updated_at);
  return {
    sessions,
    note: sessions.length === 0 ? "no shell sessions" : "shell sessions listed",
  };
}

/**
 * 查询 shell session 状态。
 */
export async function get_shell_session_status(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellQueryRequest,
): Promise<ShellActionResponse> {
  const session = await resolve_session(state, context, {
    ...request,
    include_completed: request.include_completed !== false,
  });
  if (!session) {
    throw new Error("shell session not found");
  }
  return build_action_response({
    shell: session.snapshot,
  });
}

/**
 * 读取 shell session 输出。
 */
export async function read_shell_session(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellReadRequest,
): Promise<ShellActionResponse> {
  const session = await resolve_session(state, context, {
    ...request,
    include_completed: request.include_completed !== false,
  });
  if (!session) {
    throw new Error("shell session not found");
  }
  const chunk = create_output_chunk({
    shell_id: session.snapshot.shell_id,
    output_text: session.output_text,
    from_cursor: request.from_cursor,
    context,
    max_output_tokens: request.max_output_tokens,
  });
  return build_action_response({
    shell: session.snapshot,
    chunk,
  });
}

/**
 * 等待 shell session 状态变化。
 */
export async function wait_shell_session(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellWaitRequest,
): Promise<ShellActionResponse> {
  const shell_id = String(request.shell_id || "").trim();
  if (!shell_id) throw new Error("shell.wait requires shell_id");
  const session = await resolve_session(state, context, {
    shell_id,
    include_completed: true,
  });
  if (!session) throw new Error("shell session not found");

  if (
    is_in_memory_session(session) &&
    typeof request.after_version === "number" &&
    session.snapshot.version <= request.after_version &&
    (session.snapshot.status === "running" || session.snapshot.status === "starting")
  ) {
    const after_version = request.after_version;
    await new Promise<void>((resolve) => {
      let settled = false;
      let waiter: ShellSessionWaiter;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(waiter.timer);
        session.waiters.delete(waiter);
        resolve();
      };
      const timer = setTimeout(() => {
        finish();
      }, clamp_wait_ms_with_options(
        state.options,
        request.timeout_ms,
        state.options.default_wait_timeout_ms,
      ));
      waiter = {
        resolve: finish,
        timer,
      };
      session.waiters.add(waiter);

      // 关键点（中文）：注册 waiter 后立刻复查，避免状态变化发生在判断和注册之间。
      if (
        session.snapshot.version > after_version ||
        is_terminal_status(session.snapshot.status)
      ) {
        finish();
      }
    });
  }

  const refreshed = await resolve_session(state, context, {
    shell_id,
    include_completed: true,
  });
  if (!refreshed) throw new Error("shell session not found after wait");
  const chunk = create_output_chunk({
    shell_id,
    output_text: refreshed.output_text,
    from_cursor: request.from_cursor,
    context,
    max_output_tokens: request.max_output_tokens,
  });
  return build_action_response({
    shell: refreshed.snapshot,
    chunk,
  });
}

/**
 * 关闭 shell session。
 */
export async function close_shell_session(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellCloseRequest,
): Promise<ShellActionResponse> {
  const shell_id = String(request.shell_id || "").trim();
  if (!shell_id) throw new Error("shell.close requires shell_id");
  const session = await resolve_session(state, context, {
    shell_id,
    include_completed: true,
  });
  if (!session) throw new Error("shell session not found");

  if (!is_in_memory_session(session)) {
    return build_action_response({
      shell: session.snapshot,
      note: "shell already completed and only persisted snapshot remains",
    });
  }

  if (session.cleanup_timer) {
    clearTimeout(session.cleanup_timer);
    session.cleanup_timer = null;
  }

  if (session.snapshot.status === "running" || session.snapshot.status === "starting") {
    const process_exited = await terminate_shell_session_process(
      session,
      request.force === true,
    );
    if (!process_exited) {
      throw new Error(`Shell process did not exit after termination: ${shell_id}`);
    }
  }

  schedule_cleanup(state, shell_id);
  return build_action_response({
    shell: session.snapshot,
    note: "shell close requested",
  });
}
