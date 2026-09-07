/**
 * Shell exec action。
 *
 * 关键点（中文）
 * - exec 是基于 start + wait + close 的 one-shot 编排。
 * - 保留完整输出返回，适合短命令。
 */

import type { ShellHostContext } from "@downcity/type/shell";
import type { ShellRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";
import type {
  ShellActionResponse,
  ShellExecRequest,
  ShellSessionSnapshot,
} from "@downcity/type/shell";
import {
  build_action_response,
  create_output_chunk,
  is_terminal_status,
  normalize_exec_timeout_ms,
  now_ms,
  resolve_session,
} from "../ShellActionRuntimeSupport.js";
import { close_shell_session } from "./ShellQueryActions.js";
import { start_shell_session } from "./ShellStartActions.js";

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function require_shell_snapshot(response: ShellActionResponse): ShellSessionSnapshot {
  if (!response.shell) {
    throw new Error("shell exec expected a shell snapshot response");
  }
  return response.shell;
}

/**
 * 以 one-shot 模式执行 shell command。
 */
export async function exec_shell_command(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellExecRequest,
): Promise<ShellActionResponse> {
  const timeout_ms = normalize_exec_timeout_ms(state.options, request.timeout_ms);
  const started = await start_shell_session(state, context, {
    cmd: request.cmd,
    ...(request.cwd ? { cwd: request.cwd } : {}),
    ...(request.shell ? { shell: request.shell } : {}),
    login: request.login,
    target: request.target,
    reason: request.reason,
    approval_tool_name: "shell_exec",
    terminal: false,
    inline_wait_ms: Math.min(state.options.default_inline_wait_ms, timeout_ms),
    max_output_tokens: request.max_output_tokens,
    auto_notify_on_exit: false,
    ...(request.owner_context_id ? { owner_context_id: request.owner_context_id } : {}),
    ...(request.turn_id ? { turn_id: request.turn_id } : {}),
    ...(request.tool_call_id ? { tool_call_id: request.tool_call_id } : {}),
  });
  require_shell_snapshot(started);

  let current = started;
  let current_shell = require_shell_snapshot(current);
  const active_session = state.sessions.get(current_shell.shell_id);
  active_session?.child.close_stdin?.();
  if (active_session) {
    active_session.snapshot.stdin_writable = false;
    current_shell = active_session.snapshot;
  }
  let from_cursor = current.chunk?.end_cursor ?? 0;
  const output_parts: string[] = [];
  if (current.chunk?.output) {
    output_parts.push(current.chunk.output);
  }

  const deadline = now_ms() + timeout_ms;
  while (!is_terminal_status(current_shell.status)) {
    const remaining = deadline - now_ms();
    if (remaining <= 0) {
      await close_shell_session(state, context, {
        shell_id: current_shell.shell_id,
        force: true,
      }).catch(() => undefined);
      throw new Error(
        `shell.exec timed out after ${timeout_ms}ms. Use shell_session.start for long-running commands.`,
      );
    }

    const in_memory = state.sessions.get(current_shell.shell_id);
    if (
      in_memory &&
      (in_memory.snapshot.status === "running" ||
        in_memory.snapshot.status === "starting")
    ) {
      await Promise.race([
        in_memory.completion_promise,
        sleep(Math.min(remaining, 250)),
      ]);
    } else {
      await sleep(Math.min(remaining, 250));
    }

    const refreshed = await resolve_session(state, context, {
      shell_id: current_shell.shell_id,
      include_completed: true,
    });
    if (!refreshed) {
      throw new Error(`shell session disappeared unexpectedly: ${current_shell.shell_id}`);
    }
    const chunk = create_output_chunk({
      shell_id: current_shell.shell_id,
      output_text: refreshed.output_text,
      from_cursor,
      context,
      max_output_tokens: request.max_output_tokens,
    });
    current = build_action_response({
      shell: refreshed.snapshot,
      chunk,
    });
    current_shell = require_shell_snapshot(current);
    if (chunk.output) {
      output_parts.push(chunk.output);
    }
    if (typeof chunk.end_cursor === "number") {
      from_cursor = chunk.end_cursor;
    }
  }

  const final_session = state.sessions.get(current_shell.shell_id);
  if (final_session) {
    await final_session.completion_promise;
    await final_session.write_chain.catch(() => undefined);
  }

  await close_shell_session(state, context, {
    shell_id: current_shell.shell_id,
    force: false,
  }).catch(() => undefined);

  const completed = await resolve_session(state, context, {
    shell_id: current_shell.shell_id,
    include_completed: true,
  });
  const full_output = completed?.output_text ?? output_parts.join("");
  const original_lines = full_output ? full_output.split("\n").length : 0;
  return build_action_response({
    shell: current_shell,
    chunk: {
      shell_id: current_shell.shell_id,
      output: full_output,
      start_cursor: 0,
      end_cursor: full_output.length,
      original_chars: full_output.length,
      original_lines,
      has_more_output: false,
    },
    note: "shell exec completed in one-shot mode",
  });
}
