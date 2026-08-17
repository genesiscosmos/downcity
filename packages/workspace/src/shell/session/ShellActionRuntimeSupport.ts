/**
 * Shell action 运行时辅助能力。
 *
 * 关键点（中文）
 * - 统一承载 ShellActionRuntime 的内部共享逻辑：环境组装、持久化、waiter 协调、session 查找。
 * - 对外暴露给 ShellActionRuntime 的只有纯运行时辅助函数，不直接承担 plugin action 编排。
 */

import path from "node:path";
import fs from "fs-extra";
import type { ShellHostContext } from "@/shell/types/ShellHostContext.js";
import type {
  ShellRuntimeState,
  ShellSessionRuntimeState,
} from "@/shell/session/ShellRuntimeTypes.js";
import type {
  ResolvedShellRuntimeOptions,
  ShellRuntimeOptions,
} from "@/shell/types/ShellRuntimeOptions.js";
import type {
  ShellQueryRequest,
  ShellSessionSnapshot,
  ShellSessionStatus,
} from "@/shell/types/ShellAction.js";
import { getShellOutputPath, getShellSnapshotPath } from "./Paths.js";
import { resolveOwnerContextId } from "./ShellRuntimeEnvironment.js";
export {
  buildShellEnv,
  resolveOwnerContextId,
  resolveShellCwd,
} from "./ShellRuntimeEnvironment.js";
export {
  buildActionResponse,
  createOutputChunk,
} from "./ShellActionResponse.js";

const DEFAULT_APPROVAL_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const DEFAULT_SHELL_RUNTIME_OPTIONS: ResolvedShellRuntimeOptions = {
  maxActiveShells: 64,
  cleanupDelayMs: 10 * 60 * 1000,
  maxInMemoryOutputChars: 1_000_000,
  outputPreviewChars: 280,
  minWaitMs: 50,
  maxWaitMs: 30_000,
  defaultInlineWaitMs: 1_200,
  defaultWaitTimeoutMs: 10_000,
  defaultExecTimeoutMs: 600_000,
  defaultApprovalTimeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
};

/**
 * shell.start 默认内联等待时间。
 */
export const DEFAULT_INLINE_WAIT_MS = DEFAULT_SHELL_RUNTIME_OPTIONS.defaultInlineWaitMs;

/**
 * shell.wait 默认等待超时。
 */
export const DEFAULT_WAIT_TIMEOUT_MS = DEFAULT_SHELL_RUNTIME_OPTIONS.defaultWaitTimeoutMs;

/**
 * shell.exec 默认总超时。
 */
export const DEFAULT_EXEC_TIMEOUT_MS = DEFAULT_SHELL_RUNTIME_OPTIONS.defaultExecTimeoutMs;

function readPositiveInteger(
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
export function resolveShellRuntimeOptions(
  options: ShellRuntimeOptions = {},
): ResolvedShellRuntimeOptions {
  const minWaitMs = readPositiveInteger(
    options.minWaitMs,
    DEFAULT_SHELL_RUNTIME_OPTIONS.minWaitMs,
  );
  const maxWaitMs = Math.max(
    minWaitMs,
    readPositiveInteger(
      options.maxWaitMs,
      DEFAULT_SHELL_RUNTIME_OPTIONS.maxWaitMs,
    ),
  );
  return {
    maxActiveShells: readPositiveInteger(
      options.maxActiveShells,
      DEFAULT_SHELL_RUNTIME_OPTIONS.maxActiveShells,
    ),
    cleanupDelayMs: readPositiveInteger(
      options.cleanupDelayMs,
      DEFAULT_SHELL_RUNTIME_OPTIONS.cleanupDelayMs,
    ),
    maxInMemoryOutputChars: readPositiveInteger(
      options.maxInMemoryOutputChars,
      DEFAULT_SHELL_RUNTIME_OPTIONS.maxInMemoryOutputChars,
    ),
    outputPreviewChars: readPositiveInteger(
      options.outputPreviewChars,
      DEFAULT_SHELL_RUNTIME_OPTIONS.outputPreviewChars,
    ),
    minWaitMs,
    maxWaitMs,
    defaultInlineWaitMs: readPositiveInteger(
      options.defaultInlineWaitMs,
      DEFAULT_SHELL_RUNTIME_OPTIONS.defaultInlineWaitMs,
    ),
    defaultWaitTimeoutMs: readPositiveInteger(
      options.defaultWaitTimeoutMs,
      DEFAULT_SHELL_RUNTIME_OPTIONS.defaultWaitTimeoutMs,
    ),
    defaultExecTimeoutMs: readPositiveInteger(
      options.defaultExecTimeoutMs,
      DEFAULT_SHELL_RUNTIME_OPTIONS.defaultExecTimeoutMs,
    ),
    defaultApprovalTimeoutMs: readPositiveInteger(
      options.defaultApprovalTimeoutMs,
      DEFAULT_SHELL_RUNTIME_OPTIONS.defaultApprovalTimeoutMs,
    ),
  };
}

/**
 * 创建 shell runtime 初始状态。
 */
export function createShellRuntimeState(
  options: ShellRuntimeOptions = {},
): ShellRuntimeState {
  return {
    options: resolveShellRuntimeOptions(options),
    sessions: new Map<string, ShellSessionRuntimeState>(),
    context: null,
  };
}

/**
 * 返回当前毫秒时间戳。
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * 归一化 wait/timeout 参数。
 */
export function clampWaitMs(value: number | undefined, fallback: number): number {
  return clampWaitMsWithOptions(DEFAULT_SHELL_RUNTIME_OPTIONS, value, fallback);
}

/**
 * 结合 Shell options 归一化 wait/timeout 参数。
 */
export function clampWaitMsWithOptions(
  options: ResolvedShellRuntimeOptions,
  value: number | undefined,
  fallback: number,
): number {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return Math.min(options.maxWaitMs, Math.max(options.minWaitMs, raw));
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
    : options.defaultExecTimeoutMs;
  return Math.max(1, raw);
}

function normalizeOutputChunk(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function deriveExitStatus(exitCode: number | undefined): ShellSessionStatus {
  if (exitCode === -9 || exitCode === 137) return "killed";
  if (typeof exitCode === "number" && exitCode === 0) return "completed";
  return "failed";
}

/**
 * 判断 shell 是否已进入终态。
 */
export function isTerminalStatus(status: ShellSessionStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "killed" ||
    status === "expired"
  );
}

function extractExternalRefsFromText(
  text: string,
  current: ShellSessionSnapshot["externalRefs"],
): ShellSessionSnapshot["externalRefs"] {
  const next = [...current];
  const register = (kind: string, value: string, label?: string): void => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    if (next.some((item) => item.kind === kind && item.value === normalized)) return;
    next.push({ kind, value: normalized, ...(label ? { label } : {}) });
  };

  const threadIdRegex = /thread_id[:=]\s*([a-zA-Z0-9_-]{6,})/g;
  for (const match of text.matchAll(threadIdRegex)) {
    register("thread_id", String(match[1] || ""), "external thread id");
  }
  return next;
}

/**
 * 持久化 shell snapshot。
 */
export async function persistSnapshot(session: ShellSessionRuntimeState): Promise<void> {
  await fs.ensureDir(path.dirname(session.snapshotFilePath));
  await fs.writeJson(session.snapshotFilePath, session.snapshot, { spaces: 2 });
}

function enqueuePersistedAppend(
  session: ShellSessionRuntimeState,
  text: string,
): Promise<void> {
  session.writeChain = session.writeChain.then(async () => {
    await fs.ensureDir(path.dirname(session.outputFilePath));
    await fs.appendFile(session.outputFilePath, text, "utf-8");
  });
  return session.writeChain;
}

function notifyWaiters(session: ShellSessionRuntimeState): void {
  for (const waiter of Array.from(session.waiters)) {
    clearTimeout(waiter.timer);
    session.waiters.delete(waiter);
    waiter.resolve();
  }
}

/**
 * 更新 session snapshot 并唤醒等待者。
 */
export async function updateSessionSnapshot(
  session: ShellSessionRuntimeState,
  updater: (snapshot: ShellSessionSnapshot) => void | ShellSessionSnapshot,
): Promise<void> {
  const result = updater(session.snapshot);
  if (result) {
    session.snapshot = result;
  }
  session.snapshot.updatedAt = nowMs();
  session.snapshot.version += 1;
  await persistSnapshot(session);
  notifyWaiters(session);
}

/**
 * 追加 shell 输出并同步更新快照。
 */
export async function appendSessionOutput(
  state: ShellRuntimeState,
  session: ShellSessionRuntimeState,
  raw: string,
): Promise<void> {
  const text = normalizeOutputChunk(raw);
  if (!text) return;

  session.outputText += text;
  if (session.outputText.length > state.options.maxInMemoryOutputChars) {
    const overflow = session.outputText.length - state.options.maxInMemoryOutputChars;
    session.outputText = session.outputText.slice(overflow);
    session.snapshot.droppedChars += overflow;
  }

  session.snapshot.outputChars += text.length;
  session.snapshot.lastOutputAt = nowMs();
  session.snapshot.lastOutputPreview = session.outputText
    .slice(-state.options.outputPreviewChars)
    .trim();
  session.snapshot.externalRefs = extractExternalRefsFromText(
    text,
    session.snapshot.externalRefs,
  );
  await enqueuePersistedAppend(session, text);
  await updateSessionSnapshot(session, () => undefined);
}

/**
 * 为终态 shell 安排延迟清理。
 */
export function scheduleCleanup(state: ShellRuntimeState, shellId: string): void {
  const session = state.sessions.get(shellId);
  if (!session) return;
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    const current = state.sessions.get(shellId);
    if (!current) return;
    state.sessions.delete(shellId);
  }, state.options.cleanupDelayMs);
  if (typeof session.cleanupTimer.unref === "function") {
    session.cleanupTimer.unref();
  }
}

/**
 * 控制 in-memory shell session 容量。
 */
export function ensureCapacity(state: ShellRuntimeState): void {
  if (state.sessions.size < state.options.maxActiveShells) return;
  const removable = Array.from(state.sessions.values())
    .filter((item) => item.snapshot.status !== "running" && item.snapshot.status !== "starting")
    .sort((a, b) => a.snapshot.updatedAt - b.snapshot.updatedAt);
  for (const item of removable) {
    if (state.sessions.size < state.options.maxActiveShells) break;
    state.sessions.delete(item.snapshot.shellId);
  }
  if (state.sessions.size >= state.options.maxActiveShells) {
    throw new Error(
      `Too many active shell sessions (${state.sessions.size}). Please close or wait older sessions first.`,
    );
  }
}

async function loadPersistedSnapshot(
  context: ShellHostContext,
  shellId: string,
): Promise<ShellSessionSnapshot | null> {
  const file = getShellSnapshotPath(context.dataPath, shellId);
  if (!(await fs.pathExists(file))) return null;
  const raw = await fs.readJson(file).catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const snapshot = raw as ShellSessionSnapshot;
  return typeof snapshot.shellId === "string" ? snapshot : null;
}

async function readPersistedOutput(
  context: ShellHostContext,
  shellId: string,
): Promise<string> {
  const file = getShellOutputPath(context.dataPath, shellId);
  if (!(await fs.pathExists(file))) return "";
  return await fs.readFile(file, "utf-8");
}

/**
 * 按 shellId 或 ownerContext 解析目标 session。
 */
export async function resolveSession(
  state: ShellRuntimeState,
  context: ShellHostContext,
  query: ShellQueryRequest,
): Promise<ShellSessionRuntimeState | { snapshot: ShellSessionSnapshot; outputText: string } | null> {
  const explicitShellId = String(query.shellId || "").trim();
  if (explicitShellId) {
    const inMemory = state.sessions.get(explicitShellId);
    if (inMemory) return inMemory;
    const snapshot = await loadPersistedSnapshot(context, explicitShellId);
    if (!snapshot) return null;
    return {
      snapshot,
      outputText: await readPersistedOutput(context, explicitShellId),
    };
  }

  const ownerContextId = resolveOwnerContextId(context, query.ownerContextId);
  const cmd = String(query.cmd || "").trim().toLowerCase();
  if (!ownerContextId) return null;
  const includeCompleted = query.includeCompleted === true;
  const matched = Array.from(state.sessions.values())
    .filter((item) => {
      if (item.snapshot.ownerContextId !== ownerContextId) return false;
      if (!includeCompleted) {
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
    .sort((a, b) => b.snapshot.updatedAt - a.snapshot.updatedAt);
  return matched[0] || null;
}

/**
 * 判断解析出的 session 是否仍在内存中活动。
 */
export function isInMemorySession(
  value: ShellSessionRuntimeState | { snapshot: ShellSessionSnapshot; outputText: string },
): value is ShellSessionRuntimeState {
  return "child" in value;
}

/**
 * 处理 shell 退出后的状态收口。
 */
export async function finalizeExit(
  state: ShellRuntimeState,
  session: ShellSessionRuntimeState,
  exitCode: number,
): Promise<void> {
  await updateSessionSnapshot(session, (snapshot) => {
    snapshot.status = deriveExitStatus(exitCode);
    snapshot.exitCode = exitCode;
    snapshot.endedAt = nowMs();
    snapshot.pid = session.child.pid ?? snapshot.pid;
  });
  session.resolveCompletion();
  scheduleCleanup(state, session.snapshot.shellId);

  if (session.snapshot.autoNotifyOnExit && session.snapshot.notificationSent === false) {
    session.snapshot.notificationSent = true;
    await persistSnapshot(session);
  }
}
