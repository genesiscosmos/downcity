/**
 * Shell tool 定义。
 *
 * 关键点（中文）
 * - Workspace 内置 Shell 拥有 shell tool 的 schema、执行逻辑与响应整理。
 * - Agent 只把 Shell 实例的 tools 合并到模型可调用工具集合中。
 */

import {
  define_runtime_tool,
  type RuntimeToolExecutionOptions,
} from "@downcity/type";
import type {
  ShellExecInput,
  ShellSessionInput,
} from "@downcity/type/shell";
import type { ShellActionResponse } from "@downcity/type/shell";
import {
  shell_exec_input_schema,
  shell_session_input_schema,
} from "@/shell/tool/ShellToolSchemas.js";
import { validate_chat_send_command } from "@/shell/tool/ShellToolFormatting.js";
import type {
  ShellToolAction,
  ShellExecutionContext,
  ShellToolExecutionContext,
  ShellToolRunner,
  ShellToolSet,
} from "@downcity/type/shell";

type JsonObject = Record<string, unknown>;

/**
 * 从 RuntimeTool 显式上下文中读取 Shell 运行快照。
 */
function resolve_shell_execution_context(value: unknown): ShellExecutionContext {
  if (!value || typeof value !== "object") return {};
  const context = value as Partial<ShellToolExecutionContext>;
  const execution_context = context.shell_execution_context;
  if (!execution_context || typeof execution_context !== "object") return {};
  return execution_context;
}

function flatten_shell_action_response(params: {
  /**
   * shell action 响应。
   */
  response: ShellActionResponse;
  /**
   * tool 调用开始时间。
   */
  started_at: number;
}): JsonObject {
  const shell_snapshot = params.response.shell;
  if (!shell_snapshot) {
    return {
      success: false,
      error: "shell action did not return a shell snapshot",
    };
  }
  const chunk = params.response.chunk;
  const exit_code = typeof shell_snapshot.exit_code === "number" ? shell_snapshot.exit_code : null;
  const success =
    shell_snapshot.approval_status !== "denied" &&
    (exit_code === null || exit_code === 0);
  return {
    success,
    shell_id: shell_snapshot.shell_id,
    status: shell_snapshot.status,
    cmd: shell_snapshot.cmd,
    cwd: shell_snapshot.cwd,
    target: shell_snapshot.target,
    approval_status: shell_snapshot.approval_status || null,
    approval_id: shell_snapshot.approval_id || null,
    approval_reason: shell_snapshot.approval_reason || null,
    stdin_writable: shell_snapshot.stdin_writable !== false,
    terminal: shell_snapshot.terminal === true,
    cols: shell_snapshot.cols || null,
    rows: shell_snapshot.rows || null,
    execution_backend: shell_snapshot.execution_backend,
    sandbox_id: shell_snapshot.sandbox_id || null,
    pid: typeof shell_snapshot.pid === "number" ? shell_snapshot.pid : null,
    version: shell_snapshot.version,
    started_at: shell_snapshot.started_at,
    updated_at: shell_snapshot.updated_at,
    ended_at: typeof shell_snapshot.ended_at === "number" ? shell_snapshot.ended_at : null,
    exit_code,
    output: chunk?.output || "",
    start_cursor: typeof chunk?.start_cursor === "number" ? chunk.start_cursor : null,
    end_cursor: typeof chunk?.end_cursor === "number" ? chunk.end_cursor : null,
    original_chars: chunk?.original_chars ?? 0,
    original_lines: chunk?.original_lines ?? 0,
    has_more_output: chunk?.has_more_output === true,
    last_output_preview: shell_snapshot.last_output_preview || "",
    output_chars: shell_snapshot.output_chars,
    dropped_chars: shell_snapshot.dropped_chars,
    auto_notify_on_exit: shell_snapshot.auto_notify_on_exit,
    notification_sent: shell_snapshot.notification_sent,
    owner_context_id: shell_snapshot.owner_context_id || null,
    external_refs: shell_snapshot.external_refs,
    wall_time_seconds: Math.max(0, (Date.now() - params.started_at) / 1000),
    ...(params.response.note ? { note: params.response.note } : {}),
  };
}

function flatten_shell_exec_response(params: {
  /**
   * shell action 响应。
   */
  response: ShellActionResponse;
  /**
   * tool 调用开始时间。
   */
  started_at: number;
}): JsonObject {
  const shell_snapshot = params.response.shell;
  if (!shell_snapshot) {
    return {
      success: false,
      error: "shell exec did not return a shell snapshot",
    };
  }
  const chunk = params.response.chunk;
  const exit_code = typeof shell_snapshot.exit_code === "number" ? shell_snapshot.exit_code : null;
  const success =
    shell_snapshot.approval_status !== "denied" &&
    (exit_code === null || exit_code === 0);
  return {
    success,
    status: shell_snapshot.status,
    cmd: shell_snapshot.cmd,
    cwd: shell_snapshot.cwd,
    target: shell_snapshot.target,
    approval_status: shell_snapshot.approval_status || null,
    approval_id: shell_snapshot.approval_id || null,
    approval_reason: shell_snapshot.approval_reason || null,
    stdin_writable: shell_snapshot.stdin_writable !== false,
    execution_backend: shell_snapshot.execution_backend,
    sandbox_id: shell_snapshot.sandbox_id || null,
    exit_code,
    output: chunk?.output || "",
    original_chars: chunk?.original_chars ?? 0,
    original_lines: chunk?.original_lines ?? 0,
    external_refs: shell_snapshot.external_refs,
    wall_time_seconds: Math.max(0, (Date.now() - params.started_at) / 1000),
    ...(params.response.note ? { note: params.response.note } : {}),
  };
}

function flatten_shell_list_response(params: {
  /**
   * shell action 响应。
   */
  response: ShellActionResponse;
  /**
   * tool 调用开始时间。
   */
  started_at: number;
}): JsonObject {
  return {
    success: true,
    sessions: (params.response.sessions || []).map((snapshot) => ({
      shell_id: snapshot.shell_id,
      status: snapshot.status,
      cmd: snapshot.cmd,
      cwd: snapshot.cwd,
      terminal: snapshot.terminal === true,
      target: snapshot.target,
      execution_backend: snapshot.execution_backend,
      sandbox_id: snapshot.sandbox_id || null,
      pid: typeof snapshot.pid === "number" ? snapshot.pid : null,
      version: snapshot.version,
      started_at: snapshot.started_at,
      updated_at: snapshot.updated_at,
      ended_at: typeof snapshot.ended_at === "number" ? snapshot.ended_at : null,
      exit_code: typeof snapshot.exit_code === "number" ? snapshot.exit_code : null,
      last_output_preview: snapshot.last_output_preview || "",
      output_chars: snapshot.output_chars,
    })),
    wall_time_seconds: Math.max(0, (Date.now() - params.started_at) / 1000),
    ...(params.response.note ? { note: params.response.note } : {}),
  };
}

function format_tool_error(
  prefix: string,
  error: unknown,
): { success: false; error: string } {
  return {
    success: false,
    error: `${prefix}: ${String(error)}`,
  };
}

/**
 * 创建 shell tools。
 *
 * 关键点（中文）
 * - 每个 tool.execute 从 Downcity `context` 读取显式上下文。
 * - session、turn 与 env 随 action 请求传入 Shell，不依赖异步全局状态。
 */
export function create_shell_tools(runner: ShellToolRunner): ShellToolSet {
  const session_output_cursors = new Map<string, number>();

  function remember_output_cursor(response: ShellActionResponse): void {
    const shell_id = response.shell?.shell_id || response.chunk?.shell_id || "";
    if (!shell_id || typeof response.chunk?.end_cursor !== "number") return;
    session_output_cursors.set(shell_id, response.chunk.end_cursor);
  }

  /**
   * 统一包装 run_action，自动注入当前 tool 运行上下文。
   */
  function run_action_with_context(
    action: ShellToolAction,
    payload: JsonObject,
    options: RuntimeToolExecutionOptions,
  ): Promise<ShellActionResponse> {
    const execution_context = resolve_shell_execution_context(options.context);
    return runner.run_action({
      action,
      payload,
      execution: {
        ...execution_context,
        call_id: options.tool_call_id || execution_context.call_id,
        abort_signal: options.abort_signal || execution_context.abort_signal,
      },
    });
  }

  const shell_exec = define_runtime_tool<ShellExecInput>({
    description:
      "Execute a short non-interactive shell command and wait for completion. Prefer shell_session for long-running or interactive commands.",
    input_schema: shell_exec_input_schema,
    execute: async (
      {
        cmd,
        workdir,
        shell,
        login = true,
        timeout_ms = 600000,
        max_output_tokens,
        target = "sandbox",
        reason,
      }: ShellExecInput,
      options: RuntimeToolExecutionOptions,
    ) => {
      const started_at = Date.now();
      try {
        const validation_error = validate_chat_send_command(cmd);
        if (validation_error) {
          return {
            success: false,
            error: `shell_exec rejected: ${validation_error}`,
          };
        }

        const response = await run_action_with_context(
          "exec",
          {
            cmd,
            ...(workdir ? { cwd: workdir } : {}),
            ...(shell ? { shell } : {}),
            login,
            timeout_ms: timeout_ms,
            ...(typeof max_output_tokens === "number"
              ? { max_output_tokens: max_output_tokens }
              : {}),
            target,
            ...(reason ? { reason } : {}),
          },
          options,
        );
        return flatten_shell_exec_response({ response, started_at });
      } catch (error) {
        return format_tool_error("shell_exec failed", error);
      }
    },
  });

  const shell_session = define_runtime_tool<ShellSessionInput>({
    description:
      "Operate an interactive PTY shell session. Use action=start for long-running or interactive commands, send for stdin, read for latest output, list for sessions, and stop to close.",
    input_schema: shell_session_input_schema,
    execute: async (
      input: ShellSessionInput,
      options: RuntimeToolExecutionOptions,
    ) => {
      const started_at = Date.now();
      try {
        const action = input.action;
        if (action === "start") {
          const cmd = String(input.cmd || "").trim();
          const validation_error = validate_chat_send_command(cmd);
          if (validation_error) {
            return {
              success: false,
              error: `shell_session.start rejected: ${validation_error}`,
            };
          }
          const response = await run_action_with_context(
            "start",
            {
              cmd,
              ...(input.workdir ? { cwd: input.workdir } : {}),
              ...(input.shell ? { shell: input.shell } : {}),
              login: input.login !== false,
              inline_wait_ms: input.inline_wait_ms ?? input.wait_ms ?? 1200,
              ...(typeof input.max_output_tokens === "number"
                ? { max_output_tokens: input.max_output_tokens }
                : {}),
              ...(typeof input.auto_notify_on_exit === "boolean"
                ? { auto_notify_on_exit: input.auto_notify_on_exit }
                : {}),
              terminal: true,
              ...(typeof input.cols === "number" ? { cols: input.cols } : {}),
              ...(typeof input.rows === "number" ? { rows: input.rows } : {}),
              target: input.target || "sandbox",
              ...(input.reason ? { reason: input.reason } : {}),
            },
            options,
          );
          remember_output_cursor(response);
          return flatten_shell_action_response({ response, started_at });
        }
        if (action === "send") {
          const shell_id = String(input.shell_id || "").trim();
          const from_cursor = session_output_cursors.get(shell_id);
          const response = await run_action_with_context(
            "write",
            {
              shell_id: shell_id,
              chars: input.input ?? "",
              ...(input.reason ? { reason: input.reason } : {}),
            },
            options,
          );
          const shell = response.shell;
          if (!shell) return flatten_shell_action_response({ response, started_at });
          const waited = await run_action_with_context(
            "wait",
            {
              shell_id: shell.shell_id,
              after_version: shell.version,
              from_cursor: typeof from_cursor === "number" ? from_cursor : shell.output_chars,
              timeout_ms: input.wait_ms ?? input.inline_wait_ms ?? 1000,
              ...(typeof input.max_output_tokens === "number"
                ? { max_output_tokens: input.max_output_tokens }
                : {}),
            },
            options,
          );
          remember_output_cursor(waited);
          return flatten_shell_action_response({ response: waited, started_at });
        }
        if (action === "read") {
          const shell_id = String(input.shell_id || "").trim();
          const response = await run_action_with_context(
            "read",
            {
              shell_id: shell_id,
              include_completed: true,
              ...(typeof session_output_cursors.get(shell_id) === "number"
                ? { from_cursor: session_output_cursors.get(shell_id) }
                : {}),
              ...(typeof input.max_output_tokens === "number"
                ? { max_output_tokens: input.max_output_tokens }
                : {}),
            },
            options,
          );
          remember_output_cursor(response);
          return flatten_shell_action_response({ response, started_at });
        }
        if (action === "list") {
          const response = await run_action_with_context(
            "list",
            {
              include_completed: input.include_completed !== false,
            },
            options,
          );
          return flatten_shell_list_response({ response, started_at });
        }
        if (action === "stop") {
          const response = await run_action_with_context(
            "close",
            {
              shell_id: String(input.shell_id || "").trim(),
              force: input.force === true,
            },
            options,
          );
          if (input.shell_id) session_output_cursors.delete(input.shell_id);
          return flatten_shell_action_response({ response, started_at });
        }
        return {
          success: false,
          error: `unsupported shell_session action: ${String(action)}`,
        };
      } catch (error) {
        return format_tool_error("shell_session failed", error);
      }
    },
  });

  return {
    shell_exec,
    shell_session,
  };
}
