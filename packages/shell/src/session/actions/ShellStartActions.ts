/**
 * Shell start action。
 *
 * 关键点（中文）
 * - 负责创建 shell session、发起 unrestricted 审批、启动子进程并返回初始输出。
 * - 长轮询与读取逻辑仍由 query actions 提供。
 */

import fs from "fs-extra";
import type { ShellHostContext } from "@/types/ShellHostContext.js";
import { spawn_shell_process } from "@/sandbox/Sandbox.js";
import type {
  ShellRuntimeState,
  ShellSessionRuntimeState,
  ShellSessionWaiter,
} from "@/session/ShellRuntimeTypes.js";
import { generateId } from "@/utils/Id.js";
import type {
  ShellActionResponse,
  ShellApprovalStatus,
  ShellStartRequest,
} from "@/types/ShellAction.js";
import { getShellDir, getShellOutputPath, getShellSnapshotPath } from "../Paths.js";
import {
  buildActionResponse,
  buildShellEnv,
  clampWaitMsWithOptions,
  createOutputChunk,
  ensureCapacity,
  isInMemorySession,
  persistSnapshot,
  resolveSession,
  resolveShellCwd,
} from "../ShellActionRuntimeSupport.js";
import { attachShellProcessEventHandlers } from "../ShellProcessEvents.js";
import {
  requestUnrestrictedApproval,
  validateUnrestrictedRequest,
} from "../../approval/ShellApprovalRuntime.js";
import {
  buildDeniedApprovalResponse,
  resolveDefaultShellPath,
  resolveSandboxMode,
} from "./ShellActionShared.js";
import { bindShellRuntime } from "./ShellLifecycleActions.js";
import { waitShellSession } from "./ShellQueryActions.js";

/**
 * 启动一个 shell session。
 */
export async function startShellSession(
  state: ShellRuntimeState,
  context: ShellHostContext,
  request: ShellStartRequest,
): Promise<ShellActionResponse> {
  const cmd = String(request.cmd || "").trim();
  if (!cmd) throw new Error("shell.start requires a non-empty cmd");
  ensureCapacity(state);
  bindShellRuntime(state, context);

  const shellId = `sh_${generateId()}`;
  const cwd = resolveShellCwd(context, request.cwd);
  const shellPath =
    String(request.shell || resolveDefaultShellPath()).trim() || resolveDefaultShellPath();
  const login = request.login !== false;
  const sandboxMode = resolveSandboxMode(request.sandbox);
  const reason = String(request.reason || "").trim();
  // 关键点（中文）
  // - ownerContextId/turnId 由 tool action 显式传入。
  const ownerContextId =
    String(
      request.ownerContextId || "",
    ).trim() || undefined;
  const turnId =
    String(
      request.turnId || "",
    ).trim() || undefined;
  const shellDir = getShellDir(context.dataPath, shellId);
  const snapshotFilePath = getShellSnapshotPath(context.dataPath, shellId);
  const outputFilePath = getShellOutputPath(context.dataPath, shellId);

  await fs.ensureDir(shellDir);
  await fs.writeFile(outputFilePath, "", "utf-8");

  let approvalId: string | undefined;
  let approvalStatus: ShellApprovalStatus | undefined;
  if (sandboxMode === "unrestricted") {
    const validationError = validateUnrestrictedRequest({ cmd, reason });
    if (validationError) throw new Error(validationError);
    const approval = await requestUnrestrictedApproval({
      context,
      shellId,
      toolName: request.approvalToolName || "shell_session",
      cmd,
      cwd,
      reason,
      ...(ownerContextId ? { ownerContextId } : {}),
      ...(turnId ? { turnId } : {}),
      ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
      timeoutMs: state.options.defaultApprovalTimeoutMs,
    });
    approvalId = approval.approvalId;
    approvalStatus = approval.status;
    if (approval.status !== "approved") {
      return buildDeniedApprovalResponse({
        shellId,
        ...(ownerContextId ? { ownerContextId } : {}),
        cmd,
        cwd,
        shellPath,
        approvalId: approval.approvalId,
        reason,
        approvalStatus: approval.status,
      });
    }
  }

  const spawnResult = await spawn_shell_process({
    context,
    execution_id: shellId,
    execution_dir: shellDir,
    cmd,
    cwd,
    shell_path: shellPath,
    login,
    base_env: buildShellEnv(context, ownerContextId),
    sandbox_mode: sandboxMode,
    terminal: request.terminal !== false,
    cols: request.cols,
    rows: request.rows,
  });
  const child = spawnResult.child;
  const actualCwd = spawnResult.cwd;

  const startedAt = Date.now();
  let resolveCompletion: () => void = () => {};
  const completionPromise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const session: ShellSessionRuntimeState = {
    snapshot: {
      shellId,
      ...(ownerContextId ? { ownerContextId } : {}),
      cmd,
      cwd: actualCwd,
      shellPath,
      sandboxed: spawnResult.sandboxed,
      sandboxMode: spawnResult.sandbox_mode || sandboxMode,
      sandboxBackend: spawnResult.backend,
      sandboxNetworkMode: spawnResult.network_mode,
      sandboxDir: spawnResult.sandbox_dir,
      sandboxHomeDir: spawnResult.home_dir,
      sandboxTmpDir: spawnResult.tmp_dir,
      sandboxCacheDir: spawnResult.cache_dir,
      sandboxPolicyFingerprint: spawnResult.policy_fingerprint,
      ...(approvalStatus ? { approvalStatus } : {}),
      ...(approvalId ? { approvalId } : {}),
      ...(reason ? { approvalReason: reason } : {}),
      stdinWritable: true,
      terminal: request.terminal !== false,
      ...(typeof request.cols === "number" ? { cols: request.cols } : {}),
      ...(typeof request.rows === "number" ? { rows: request.rows } : {}),
      status: "running",
      ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
      startedAt,
      updatedAt: startedAt,
      outputChars: 0,
      droppedChars: 0,
      version: 1,
      autoNotifyOnExit: request.autoNotifyOnExit === true,
      notificationSent: false,
      externalRefs: [],
    },
    child,
    outputText: "",
    outputFilePath,
    snapshotFilePath,
    writeChain: Promise.resolve(),
    cleanupTimer: null,
    waiters: new Set<ShellSessionWaiter>(),
    completionPromise,
    resolveCompletion,
  };
  state.sessions.set(shellId, session);

  // 关键点（中文）：监听器必须先挂上，避免瞬时命令在 snapshot 持久化期间退出而丢失 close 事件。
  attachShellProcessEventHandlers({ state, session });
  await persistSnapshot(session);

  const inlineWaitMs = clampWaitMsWithOptions(
    state.options,
    request.inlineWaitMs,
    state.options.defaultInlineWaitMs,
  );
  await waitShellSession(state, context, {
    shellId,
    afterVersion: 1,
    fromCursor: 0,
    timeoutMs: inlineWaitMs,
    maxOutputTokens: request.maxOutputTokens,
  }).catch(() => undefined);

  const latest = await resolveSession(state, context, { shellId, includeCompleted: true });
  if (!latest) {
    throw new Error(`shell session disappeared unexpectedly: ${shellId}`);
  }
  if (
    isInMemorySession(latest) &&
    latest.snapshot.status === "running" &&
    latest.snapshot.autoNotifyOnExit === false &&
    request.autoNotifyOnExit !== false &&
    Boolean(ownerContextId)
  ) {
    latest.snapshot.autoNotifyOnExit = true;
    await persistSnapshot(latest);
  }
  const chunk = createOutputChunk({
    shellId,
    outputText: latest.outputText,
    fromCursor: 0,
    context,
    maxOutputTokens: request.maxOutputTokens,
  });
  return buildActionResponse({
    shell: latest.snapshot,
    chunk,
    note:
      latest.snapshot.status === "running"
        ? "shell started and is still running"
        : "shell finished during inline wait",
  });
}
