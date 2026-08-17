/**
 * Shell tool 定义。
 *
 * 关键点（中文）
 * - Workspace 内置 Shell 拥有 shell tool 的 schema、执行逻辑与响应整理。
 * - Agent 只把 Shell 实例的 tools 合并到模型可调用工具集合中。
 */

import { tool, type ToolExecutionOptions } from "ai";
import type {
  ShellExecInput,
  ShellSessionInput,
} from "@/shell/types/Shell.js";
import type { ShellActionResponse } from "@/shell/types/ShellAction.js";
import {
  shellExecInputSchema,
  shellSessionInputSchema,
} from "@/shell/tool/ShellToolSchemas.js";
import { validateChatSendCommand } from "@/shell/tool/ShellToolFormatting.js";
import type {
  ShellToolAction,
  ShellToolExecutionContext,
  ShellToolRunContext,
  ShellToolRunner,
  ShellToolSet,
} from "@/shell/types/ShellRuntime.js";

type JsonObject = Record<string, unknown>;

/**
 * 从 AI SDK tool 显式上下文中读取 Shell 运行快照。
 */
function resolve_shell_run_context(value: unknown): ShellToolRunContext {
  if (!value || typeof value !== "object") return {};
  const context = value as Partial<ShellToolExecutionContext>;
  const run_context = context.shell_run_context;
  if (!run_context || typeof run_context !== "object") return {};
  return run_context;
}

function flattenShellActionResponse(params: {
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
  const exit_code = typeof shell_snapshot.exitCode === "number" ? shell_snapshot.exitCode : null;
  const success =
    shell_snapshot.approvalStatus !== "denied" &&
    shell_snapshot.approvalStatus !== "expired" &&
    (exit_code === null || exit_code === 0);
  return {
    success,
    shell_id: shell_snapshot.shellId,
    status: shell_snapshot.status,
    cmd: shell_snapshot.cmd,
    cwd: shell_snapshot.cwd,
    sandboxed: shell_snapshot.sandboxed === true,
    sandbox: shell_snapshot.sandboxMode || (shell_snapshot.sandboxed === false ? "unrestricted" : "safe"),
    approval_status: shell_snapshot.approvalStatus || null,
    approval_id: shell_snapshot.approvalId || null,
    approval_reason: shell_snapshot.approvalReason || null,
    stdin_writable: shell_snapshot.stdinWritable !== false,
    terminal: shell_snapshot.terminal === true,
    cols: shell_snapshot.cols || null,
    rows: shell_snapshot.rows || null,
    sandbox_backend: shell_snapshot.sandboxBackend || null,
    sandbox_network_mode: shell_snapshot.sandboxNetworkMode || null,
    sandbox_policy_fingerprint: shell_snapshot.sandboxPolicyFingerprint || null,
    sandbox_dir: shell_snapshot.sandboxDir || null,
    sandbox_home_dir: shell_snapshot.sandboxHomeDir || null,
    sandbox_tmp_dir: shell_snapshot.sandboxTmpDir || null,
    sandbox_cache_dir: shell_snapshot.sandboxCacheDir || null,
    pid: typeof shell_snapshot.pid === "number" ? shell_snapshot.pid : null,
    version: shell_snapshot.version,
    started_at: shell_snapshot.startedAt,
    updated_at: shell_snapshot.updatedAt,
    ended_at: typeof shell_snapshot.endedAt === "number" ? shell_snapshot.endedAt : null,
    exit_code,
    output: chunk?.output || "",
    start_cursor: typeof chunk?.startCursor === "number" ? chunk.startCursor : null,
    end_cursor: typeof chunk?.endCursor === "number" ? chunk.endCursor : null,
    original_chars: chunk?.originalChars ?? 0,
    original_lines: chunk?.originalLines ?? 0,
    has_more_output: chunk?.hasMoreOutput === true,
    last_output_preview: shell_snapshot.lastOutputPreview || "",
    output_chars: shell_snapshot.outputChars,
    dropped_chars: shell_snapshot.droppedChars,
    auto_notify_on_exit: shell_snapshot.autoNotifyOnExit,
    notification_sent: shell_snapshot.notificationSent,
    owner_context_id: shell_snapshot.ownerContextId || null,
    external_refs: shell_snapshot.externalRefs,
    wall_time_seconds: Math.max(0, (Date.now() - params.started_at) / 1000),
    ...(params.response.note ? { note: params.response.note } : {}),
  };
}

function flattenShellExecResponse(params: {
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
  const exit_code = typeof shell_snapshot.exitCode === "number" ? shell_snapshot.exitCode : null;
  const success =
    shell_snapshot.approvalStatus !== "denied" &&
    shell_snapshot.approvalStatus !== "expired" &&
    (exit_code === null || exit_code === 0);
  return {
    success,
    status: shell_snapshot.status,
    cmd: shell_snapshot.cmd,
    cwd: shell_snapshot.cwd,
    sandboxed: shell_snapshot.sandboxed === true,
    sandbox: shell_snapshot.sandboxMode || (shell_snapshot.sandboxed === false ? "unrestricted" : "safe"),
    approval_status: shell_snapshot.approvalStatus || null,
    approval_id: shell_snapshot.approvalId || null,
    approval_reason: shell_snapshot.approvalReason || null,
    stdin_writable: shell_snapshot.stdinWritable !== false,
    sandbox_backend: shell_snapshot.sandboxBackend || null,
    sandbox_network_mode: shell_snapshot.sandboxNetworkMode || null,
    sandbox_policy_fingerprint: shell_snapshot.sandboxPolicyFingerprint || null,
    sandbox_dir: shell_snapshot.sandboxDir || null,
    sandbox_home_dir: shell_snapshot.sandboxHomeDir || null,
    sandbox_tmp_dir: shell_snapshot.sandboxTmpDir || null,
    sandbox_cache_dir: shell_snapshot.sandboxCacheDir || null,
    exit_code,
    output: chunk?.output || "",
    original_chars: chunk?.originalChars ?? 0,
    original_lines: chunk?.originalLines ?? 0,
    external_refs: shell_snapshot.externalRefs,
    wall_time_seconds: Math.max(0, (Date.now() - params.started_at) / 1000),
    ...(params.response.note ? { note: params.response.note } : {}),
  };
}

function flattenShellListResponse(params: {
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
      shell_id: snapshot.shellId,
      status: snapshot.status,
      cmd: snapshot.cmd,
      cwd: snapshot.cwd,
      terminal: snapshot.terminal === true,
      sandbox: snapshot.sandboxMode || (snapshot.sandboxed === false ? "unrestricted" : "safe"),
      sandbox_policy_fingerprint: snapshot.sandboxPolicyFingerprint || null,
      pid: typeof snapshot.pid === "number" ? snapshot.pid : null,
      version: snapshot.version,
      started_at: snapshot.startedAt,
      updated_at: snapshot.updatedAt,
      ended_at: typeof snapshot.endedAt === "number" ? snapshot.endedAt : null,
      exit_code: typeof snapshot.exitCode === "number" ? snapshot.exitCode : null,
      last_output_preview: snapshot.lastOutputPreview || "",
      output_chars: snapshot.outputChars,
    })),
    wall_time_seconds: Math.max(0, (Date.now() - params.started_at) / 1000),
    ...(params.response.note ? { note: params.response.note } : {}),
  };
}

function formatToolError(
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
 * - 每个 tool.execute 从 AI SDK `experimental_context` 读取显式上下文。
 * - session、turn 与 env 随 action 请求传入 Shell，不依赖异步全局状态。
 */
export function createShellTools(runner: ShellToolRunner): ShellToolSet {
  const session_output_cursors = new Map<string, number>();

  function remember_output_cursor(response: ShellActionResponse): void {
    const shell_id = response.shell?.shellId || response.chunk?.shellId || "";
    if (!shell_id || typeof response.chunk?.endCursor !== "number") return;
    session_output_cursors.set(shell_id, response.chunk.endCursor);
  }

  /**
   * 统一包装 run_action，自动注入当前 tool 运行上下文。
   */
  function run_action_with_context(
    action: ShellToolAction,
    payload: JsonObject,
    options: ToolExecutionOptions,
  ): Promise<ShellActionResponse> {
    const run_context = resolve_shell_run_context(options.experimental_context);
    return runner.run_action({
      action,
      payload,
      ownerContextId: run_context.ownerContextId,
      turnId: run_context.turnId,
      env: run_context.env,
      approval_gateway: run_context.approval_gateway,
      toolCallId: options.toolCallId,
    });
  }

  const shell_exec = tool({
    description:
      "Execute a short non-interactive shell command and wait for completion. Prefer shell_session for long-running or interactive commands.",
    inputSchema: shellExecInputSchema,
    execute: async (
      {
        cmd,
        workdir,
        shell,
        login = true,
        timeout_ms = 600000,
        max_output_tokens,
        sandbox = "safe",
        reason,
      }: ShellExecInput,
      options: ToolExecutionOptions,
    ) => {
      const started_at = Date.now();
      try {
        const validation_error = validateChatSendCommand(cmd);
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
            timeoutMs: timeout_ms,
            ...(typeof max_output_tokens === "number"
              ? { maxOutputTokens: max_output_tokens }
              : {}),
            sandbox,
            ...(reason ? { reason } : {}),
          },
          options,
        );
        return flattenShellExecResponse({ response, started_at });
      } catch (error) {
        return formatToolError("shell_exec failed", error);
      }
    },
  });

  const shell_session = tool({
    description:
      "Operate an interactive PTY shell session. Use action=start for long-running or interactive commands, send for stdin, read for latest output, list for sessions, and stop to close.",
    inputSchema: shellSessionInputSchema,
    execute: async (
      input: ShellSessionInput,
      options: ToolExecutionOptions,
    ) => {
      const started_at = Date.now();
      try {
        const action = input.action;
        if (action === "start") {
          const cmd = String(input.cmd || "").trim();
          const validation_error = validateChatSendCommand(cmd);
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
              inlineWaitMs: input.inline_wait_ms ?? input.wait_ms ?? 1200,
              ...(typeof input.max_output_tokens === "number"
                ? { maxOutputTokens: input.max_output_tokens }
                : {}),
              ...(typeof input.auto_notify_on_exit === "boolean"
                ? { autoNotifyOnExit: input.auto_notify_on_exit }
                : {}),
              terminal: true,
              ...(typeof input.cols === "number" ? { cols: input.cols } : {}),
              ...(typeof input.rows === "number" ? { rows: input.rows } : {}),
              sandbox: input.sandbox || "safe",
              ...(input.reason ? { reason: input.reason } : {}),
            },
            options,
          );
          remember_output_cursor(response);
          return flattenShellActionResponse({ response, started_at });
        }
        if (action === "send") {
          const shell_id = String(input.shell_id || "").trim();
          const from_cursor = session_output_cursors.get(shell_id);
          const response = await run_action_with_context(
            "write",
            {
              shellId: shell_id,
              chars: input.input ?? "",
              ...(input.reason ? { reason: input.reason } : {}),
            },
            options,
          );
          const shell = response.shell;
          if (!shell) return flattenShellActionResponse({ response, started_at });
          const waited = await run_action_with_context(
            "wait",
            {
              shellId: shell.shellId,
              afterVersion: shell.version,
              fromCursor: typeof from_cursor === "number" ? from_cursor : shell.outputChars,
              timeoutMs: input.wait_ms ?? input.inline_wait_ms ?? 1000,
              ...(typeof input.max_output_tokens === "number"
                ? { maxOutputTokens: input.max_output_tokens }
                : {}),
            },
            options,
          );
          remember_output_cursor(waited);
          return flattenShellActionResponse({ response: waited, started_at });
        }
        if (action === "read") {
          const shell_id = String(input.shell_id || "").trim();
          const response = await run_action_with_context(
            "read",
            {
              shellId: shell_id,
              includeCompleted: true,
              ...(typeof session_output_cursors.get(shell_id) === "number"
                ? { fromCursor: session_output_cursors.get(shell_id) }
                : {}),
              ...(typeof input.max_output_tokens === "number"
                ? { maxOutputTokens: input.max_output_tokens }
                : {}),
            },
            options,
          );
          remember_output_cursor(response);
          return flattenShellActionResponse({ response, started_at });
        }
        if (action === "list") {
          const response = await run_action_with_context(
            "list",
            {
              includeCompleted: input.include_completed !== false,
            },
            options,
          );
          return flattenShellListResponse({ response, started_at });
        }
        if (action === "stop") {
          const response = await run_action_with_context(
            "close",
            {
              shellId: String(input.shell_id || "").trim(),
              force: input.force === true,
            },
            options,
          );
          if (input.shell_id) session_output_cursors.delete(input.shell_id);
          return flattenShellActionResponse({ response, started_at });
        }
        return {
          success: false,
          error: `unsupported shell_session action: ${String(action)}`,
        };
      } catch (error) {
        return formatToolError("shell_session failed", error);
      }
    },
  });

  return {
    shell_exec,
    shell_session,
  };
}
