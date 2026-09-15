/**
 * Shell action 运行时辅助能力。
 *
 * 关键点（中文）
 * - 统一承载 ShellActionRuntime 的内部共享逻辑：环境组装、持久化、waiter 协调、session 查找。
 * - 对外暴露给 ShellActionRuntime 的只有纯运行时辅助函数，不直接承担 plugin action 编排。
 */

import path from "node:path";
import fs from "fs-extra";
import type { ShellHostContext } from "@downcity/type/shell";
import type {
  ShellRuntimeState,
  ShellSessionRuntimeState,
} from "@/shell/session/ShellRuntimeTypes.js";
import type {
  ResolvedShellRuntimeOptions,
  ShellRuntimeOptions,
} from "@downcity/type/shell";
import type {
  ShellQueryRequest,
  ShellSessionSnapshot,
  ShellSessionStatus,
} from "@downcity/type/shell";
import { get_shell_output_path, get_shell_snapshot_path } from "./Paths.js";
import { resolve_owner_context_id } from "./ShellRuntimeEnvironment.js";
export {
  build_shell_env,
  resolve_owner_context_id,
  resolve_shell_cwd,
} from "./ShellRuntimeEnvironment.js";
export {
  build_action_response,
  create_output_chunk,
} from "./ShellActionResponse.js";

const DEFAULT_SHELL_RUNTIME_OPTIONS: ResolvedShellRuntimeOptions = {
  max_active_shells: 64,
  cleanup_delay_ms: 10 * 60 * 1000,
  max_in_memory_output_chars: 1_000_000,
  output_preview_chars: 280,
  min_wait_ms: 50,
  max_wait_ms: 30_000,
  default_inline_wait_ms: 1_200,
  default_wait_timeout_ms: 10_000,
  default_exec_timeout_ms: 600_000,
};

/**
 * shell.start 默认内联等待时间。
 */
export const DEFAULT_INLINE_WAIT_MS = DEFAULT_SHELL_RUNTIME_OPTIONS.default_inline_wait_ms;

/**
 * shell.wait 默认等待超时。
 */
export const DEFAULT_WAIT_TIMEOUT_MS = DEFAULT_SHELL_RUNTIME_OPTIONS.default_wait_timeout_ms;

/**
 * shell.exec 默认总超时。
 */
export const DEFAULT_EXEC_TIMEOUT_MS = DEFAULT_SHELL_RUNTIME_OPTIONS.default_exec_timeout_ms;

function read_positive_integer(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * 归一化 Shell 可选运行参数。
 */
export function resolve_shell_runtime_options(
  options: ShellRuntimeOptions = {},
): ResolvedShellRuntimeOptions {
  const min_wait_ms = read_positive_integer(
    options.min_wait_ms,
    DEFAULT_SHELL_RUNTIME_OPTIONS.min_wait_ms,
  );
  const max_wait_ms = Math.max(
    min_wait_ms,
    read_positive_integer(
      options.max_wait_ms,
      DEFAULT_SHELL_RUNTIME_OPTIONS.max_wait_ms,
    ),
  );
  return {
    max_active_shells: read_positive_integer(
      options.max_active_shells,
      DEFAULT_SHELL_RUNTIME_OPTIONS.max_active_shells,
    ),
    cleanup_delay_ms: read_positive_integer(
      options.cleanup_delay_ms,
      DEFAULT_SHELL_RUNTIME_OPTIONS.cleanup_delay_ms,
    ),
    max_in_memory_output_chars: read_positive_integer(
      options.max_in_memory_output_chars,
      DEFAULT_SHELL_RUNTIME_OPTIONS.max_in_memory_output_chars,
    ),
    output_preview_chars: read_positive_integer(
      options.output_preview_chars,
      DEFAULT_SHELL_RUNTIME_OPTIONS.output_preview_chars,
    ),
    min_wait_ms,
    max_wait_ms,
    default_inline_wait_ms: read_positive_integer(
      options.default_inline_wait_ms,
      DEFAULT_SHELL_RUNTIME_OPTIONS.default_inline_wait_ms,
    ),
    default_wait_timeout_ms: read_positive_integer(
      options.default_wait_timeout_ms,
      DEFAULT_SHELL_RUNTIME_OPTIONS.default_wait_timeout_ms,
    ),
    default_exec_timeout_ms: read_positive_integer(
      options.default_exec_timeout_ms,
      DEFAULT_SHELL_RUNTIME_OPTIONS.default_exec_timeout_ms,
    ),
  };
}

/**
 * 创建 shell runtime 初始状态。
 */
export function create_shell_runtime_state(
  options: ShellRuntimeOptions = {},
): ShellRuntimeState {
  return {
    options: resolve_shell_runtime_options(options),
    sessions: new Map<string, ShellSessionRuntimeState>(),
    context: null,
  };
}

/**
 * 返回当前毫秒时间戳。
 */
export function now_ms(): number {
  return Date.now();
}

/**
 * 归一化 wait/timeout 参数。
 */
export function clamp_wait_ms(value: number | undefined, fallback: number): number {
  return clamp_wait_ms_with_options(DEFAULT_SHELL_RUNTIME_OPTIONS, value, fallback);
}

/**
 * 结合 Shell options 归一化 wait/timeout 参数。
 */
export function clamp_wait_ms_with_options(
  options: ResolvedShellRuntimeOptions,
  value: number | undefined,
  fallback: number,
): number {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return Math.min(options.max_wait_ms, Math.max(options.min_wait_ms, raw));
}

/**
 * 归一化 shell.exec 的总执行时长。
 *
 * 总执行时长与单次 wait 的 min/max 边界无关；调用方显式传入的短超时必须保留。
 */
export function normalize_exec_timeout_ms(
  options: ResolvedShellRuntimeOptions,
  value: number | undefined,
): number {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : options.default_exec_timeout_ms;
  return Math.max(1, raw);
}

function normalize_output_chunk(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function derive_exit_status(exit_code: number | undefined): ShellSessionStatus {
  if (exit_code === -9 || exit_code === 137) return "killed";
  if (typeof exit_code === "number" && exit_code === 0) return "completed";
  return "failed";
}

/**
 * 判断 shell 是否已进入终态。
 */
export function is_terminal_status(status: ShellSessionStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "killed"
  );
}

function extract_external_refs_from_text(
  text: string,
  current: ShellSessionSnapshot["external_refs"],
): ShellSessionSnapshot["external_refs"] {
  const next = [...current];
  const register = (kind: string, value: string, label?: string): void => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    if (next.some((item) => item.kind === kind && item.value === normalized)) return;
    next.push({ kind, value: normalized, ...(label ? { label } : {}) });
  };

  const thread_id_regex = /thread_id[:=]\s*([a-zA-Z0-9_-]{6,})/g;
  for (const match of text.matchAll(thread_id_regex)) {
    register("thread_id", String(match[1] || ""), "external thread id");
  }
  return next;
}

/**
 * 持久化 shell snapshot。
 */
export async function persist_snapshot(session: ShellSessionRuntimeState): Promise<void> {
  await fs.ensureDir(path.dirname(session.snapshot_file_path));
  await fs.writeJson(session.snapshot_file_path, session.snapshot, { spaces: 2 });
}

function enqueue_persisted_append(
  session: ShellSessionRuntimeState,
  text: string,
): Promise<void> {
  session.write_chain = session.write_chain.then(async () => {
    await fs.ensureDir(path.dirname(session.output_file_path));
    await fs.appendFile(session.output_file_path, text, "utf-8");
  });
  return session.write_chain;
}

function notify_waiters(session: ShellSessionRuntimeState): void {
  for (const waiter of Array.from(session.waiters)) {
    clearTimeout(waiter.timer);
    session.waiters.delete(waiter);
    waiter.resolve();
  }
}

/**
 * 更新 session snapshot 并唤醒等待者。
 */
export async function update_session_snapshot(
  session: ShellSessionRuntimeState,
  updater: (snapshot: ShellSessionSnapshot) => void | ShellSessionSnapshot,
): Promise<void> {
  const result = updater(session.snapshot);
  if (result) {
    session.snapshot = result;
  }
  session.snapshot.updated_at = now_ms();
  session.snapshot.version += 1;
  await persist_snapshot(session);
  notify_waiters(session);
}

/**
 * 追加 shell 输出并同步更新快照。
 */
export async function append_session_output(
  state: ShellRuntimeState,
  session: ShellSessionRuntimeState,
  raw: string,
): Promise<void> {
  const text = normalize_output_chunk(raw);
  if (!text) return;

  session.output_text += text;
  if (session.output_text.length > state.options.max_in_memory_output_chars) {
    const overflow = session.output_text.length - state.options.max_in_memory_output_chars;
    session.output_text = session.output_text.slice(overflow);
    session.snapshot.dropped_chars += overflow;
  }

  session.snapshot.output_chars += text.length;
  session.snapshot.last_output_at = now_ms();
  session.snapshot.last_output_preview = session.output_text
    .slice(-state.options.output_preview_chars)
    .trim();
  session.snapshot.external_refs = extract_external_refs_from_text(
    text,
    session.snapshot.external_refs,
  );
  await enqueue_persisted_append(session, text);
  await update_session_snapshot(session, () => undefined);
}

/**
 * 为终态 shell 安排延迟清理。
 */
export function schedule_cleanup(state: ShellRuntimeState, shell_id: string): void {
  const session = state.sessions.get(shell_id);
  if (!session) return;
  if (session.cleanup_timer) clearTimeout(session.cleanup_timer);
  session.cleanup_timer = setTimeout(() => {
    const current = state.sessions.get(shell_id);
    if (!current) return;
    state.sessions.delete(shell_id);
  }, state.options.cleanup_delay_ms);
  if (typeof session.cleanup_timer.unref === "function") {
    session.cleanup_timer.unref();
  }
}

/**
 * 控制 in-memory shell session 容量。
 */
export function ensure_capacity(state: ShellRuntimeState): void {
  if (state.sessions.size < state.options.max_active_shells) return;
  const removable = Array.from(state.sessions.values())
    .filter((item) => item.snapshot.status !== "running" && item.snapshot.status !== "starting")
    .sort((a, b) => a.snapshot.updated_at - b.snapshot.updated_at);
  for (const item of removable) {
    if (state.sessions.size < state.options.max_active_shells) break;
    state.sessions.delete(item.snapshot.shell_id);
  }
  if (state.sessions.size >= state.options.max_active_shells) {
    throw new Error(
      `Too many active shell sessions (${state.sessions.size}). Please close or wait older sessions first.`,
    );
  }
}

async function load_persisted_snapshot(
  context: ShellHostContext,
  shell_id: string,
): Promise<ShellSessionSnapshot | null> {
  const file = get_shell_snapshot_path(context.data_path, shell_id);
  if (!(await fs.pathExists(file))) return null;
  const raw = await fs.readJson(file).catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const snapshot = raw as ShellSessionSnapshot;
  return typeof snapshot.shell_id === "string" ? snapshot : null;
}

async function read_persisted_output(
  context: ShellHostContext,
  shell_id: string,
): Promise<string> {
  const file = get_shell_output_path(context.data_path, shell_id);
  if (!(await fs.pathExists(file))) return "";
  return await fs.readFile(file, "utf-8");
}

/**
 * 按 shell_id 或 ownerContext 解析目标 session。
 */
export async function resolve_session(
  state: ShellRuntimeState,
  context: ShellHostContext,
  query: ShellQueryRequest,
): Promise<ShellSessionRuntimeState | { snapshot: ShellSessionSnapshot; output_text: string } | null> {
  const explicit_shell_id = String(query.shell_id || "").trim();
  if (explicit_shell_id) {
    const in_memory = state.sessions.get(explicit_shell_id);
    if (in_memory) return in_memory;
    const snapshot = await load_persisted_snapshot(context, explicit_shell_id);
    if (!snapshot) return null;
    return {
      snapshot,
      output_text: await read_persisted_output(context, explicit_shell_id),
    };
  }

  const owner_context_id = resolve_owner_context_id(context, query.owner_context_id);
  const cmd = String(query.cmd || "").trim().toLowerCase();
  if (!owner_context_id) return null;
  const include_completed = query.include_completed === true;
  const matched = Array.from(state.sessions.values())
    .filter((item) => {
      if (item.snapshot.owner_context_id !== owner_context_id) return false;
      if (!include_completed) {
        if (
          item.snapshot.status !== "running" &&
          item.snapshot.status !== "starting"
        ) {
          return false;
        }
      }
      if (!cmd) return true;
      return item.snapshot.cmd.toLowerCase().includes(cmd);
    })
    .sort((a, b) => b.snapshot.updated_at - a.snapshot.updated_at);
  return matched[0] || null;
}

/**
 * 判断解析出的 session 是否仍在内存中活动。
 */
export function is_in_memory_session(
  value: ShellSessionRuntimeState | { snapshot: ShellSessionSnapshot; output_text: string },
): value is ShellSessionRuntimeState {
  return "child" in value;
}

/**
 * 处理 shell 退出后的状态收口。
 */
export async function finalize_exit(
  state: ShellRuntimeState,
  session: ShellSessionRuntimeState,
  exit_code: number,
): Promise<void> {
  await update_session_snapshot(session, (snapshot) => {
    snapshot.status = derive_exit_status(exit_code);
    snapshot.exit_code = exit_code;
    snapshot.ended_at = now_ms();
    snapshot.pid = session.child.pid ?? snapshot.pid;
  });
  session.resolve_completion();
  schedule_cleanup(state, session.snapshot.shell_id);

  if (session.snapshot.auto_notify_on_exit && session.snapshot.notification_sent === false) {
    session.snapshot.notification_sent = true;
    await persist_snapshot(session);
  }
}
