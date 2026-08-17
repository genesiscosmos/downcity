/**
 * Shell query/read/wait/close actions。
 *
 * 关键点（中文）
 * - 聚合不创建新进程的 session 操作。
 * - close 只负责单个 session，runtime shutdown 使用 lifecycle action。
 */

import type { ShellHostContext } from "@/shell/types/ShellHostContext.js";
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
} from "@/shell/types/ShellAction.js";
import {
  buildActionResponse,
  clampWaitMsWithOptions,
  createOutputChunk,
  isInMemorySession,
  isTerminalStatus,
  resolveOwnerContextId,
  resolveSession,
  scheduleCleanup,
} from "../ShellActionRuntimeSupport.js";
import { terminate_shell_session_process } from "../ShellProcessLifecycle.js";

/**
 * 列出当前 runtime 内的 shell sessions。
 */
export async function listShellSessions(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellListRequest,
): Promise<ShellActionResponse> {
  const ownerContextId = resolveOwnerContextId(context, request.ownerContextId);
  const includeCompleted = request.includeCompleted !== false;
  const sessions = Array.from(state.sessions.values())
    .map((item) => item.snapshot)
    .filter((snapshot) => {
      if (ownerContextId && snapshot.ownerContextId !== ownerContextId) return false;
      if (includeCompleted) return true;
      return snapshot.status === "running" || snapshot.status === "starting";
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return {
    sessions,
    note: sessions.length === 0 ? "no shell sessions" : "shell sessions listed",
  };
}

/**
 * 查询 shell session 状态。
 */
export async function getShellSessionStatus(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellQueryRequest,
): Promise<ShellActionResponse> {
  const session = await resolveSession(state, context, {
    ...request,
    includeCompleted: request.includeCompleted !== false,
  });
  if (!session) {
    throw new Error("shell session not found");
  }
  return buildActionResponse({
    shell: session.snapshot,
  });
}

/**
 * 读取 shell session 输出。
 */
export async function readShellSession(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellReadRequest,
): Promise<ShellActionResponse> {
  const session = await resolveSession(state, context, {
    ...request,
    includeCompleted: request.includeCompleted !== false,
  });
  if (!session) {
    throw new Error("shell session not found");
  }
  const chunk = createOutputChunk({
    shellId: session.snapshot.shellId,
    outputText: session.outputText,
    fromCursor: request.fromCursor,
    context,
    maxOutputTokens: request.maxOutputTokens,
  });
  return buildActionResponse({
    shell: session.snapshot,
    chunk,
  });
}

/**
 * 等待 shell session 状态变化。
 */
export async function waitShellSession(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellWaitRequest,
): Promise<ShellActionResponse> {
  const shellId = String(request.shellId || "").trim();
  if (!shellId) throw new Error("shell.wait requires shellId");
  const session = await resolveSession(state, context, {
    shellId,
    includeCompleted: true,
  });
  if (!session) throw new Error("shell session not found");

  if (
    isInMemorySession(session) &&
    typeof request.afterVersion === "number" &&
    session.snapshot.version <= request.afterVersion &&
    (session.snapshot.status === "running" || session.snapshot.status === "starting")
  ) {
    const afterVersion = request.afterVersion;
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
      }, clampWaitMsWithOptions(
        state.options,
        request.timeoutMs,
        state.options.defaultWaitTimeoutMs,
      ));
      waiter = {
        resolve: finish,
        timer,
      };
      session.waiters.add(waiter);

      // 关键点（中文）：注册 waiter 后立刻复查，避免状态变化发生在判断和注册之间。
      if (
        session.snapshot.version > afterVersion ||
        isTerminalStatus(session.snapshot.status)
      ) {
        finish();
      }
    });
  }

  const refreshed = await resolveSession(state, context, {
    shellId,
    includeCompleted: true,
  });
  if (!refreshed) throw new Error("shell session not found after wait");
  const chunk = createOutputChunk({
    shellId,
    outputText: refreshed.outputText,
    fromCursor: request.fromCursor,
    context,
    maxOutputTokens: request.maxOutputTokens,
  });
  return buildActionResponse({
    shell: refreshed.snapshot,
    chunk,
  });
}

/**
 * 关闭 shell session。
 */
export async function closeShellSession(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellCloseRequest,
): Promise<ShellActionResponse> {
  const shellId = String(request.shellId || "").trim();
  if (!shellId) throw new Error("shell.close requires shellId");
  const session = await resolveSession(state, context, {
    shellId,
    includeCompleted: true,
  });
  if (!session) throw new Error("shell session not found");

  if (!isInMemorySession(session)) {
    return buildActionResponse({
      shell: session.snapshot,
      note: "shell already completed and only persisted snapshot remains",
    });
  }

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }

  if (session.snapshot.status === "running" || session.snapshot.status === "starting") {
    const process_exited = await terminate_shell_session_process(
      session,
      request.force === true,
    );
    if (!process_exited) {
      throw new Error(`Shell process did not exit after termination: ${shellId}`);
    }
  }

  scheduleCleanup(state, shellId);
  return buildActionResponse({
    shell: session.snapshot,
    note: "shell close requested",
  });
}
