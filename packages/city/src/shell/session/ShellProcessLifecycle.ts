/**
 * Shell 子进程终止生命周期。
 *
 * 关键点（中文）
 * - session 是子进程的唯一拥有者，终止操作必须等待真实 exit 事件后才能视为完成。
 * - 平台进程句柄可能延迟上报退出，因此每一段等待都必须有界，避免 dispose 永久阻塞。
 * - 交互式 shell 会忽略 SIGTERM（bash 手册明确：无 trap 时忽略，以免 `kill 0` 自杀），
 *   因此默认终止必须在优雅信号无效后升级为 SIGKILL，否则交互式会话永远关不掉。
 */

import type { ShellSessionRuntimeState } from "@/shell/session/ShellRuntimeTypes.js";

/** 等待 SIGTERM 生效的上限；超时即判定为忽略信号并升级。 */
const GRACEFUL_TERMINATION_WAIT_MS = 1_000;

/** 等待 SIGKILL 生效的上限；超时说明平台句柄未能上报退出。 */
const FORCED_TERMINATION_WAIT_MS = 1_000;

/** 在固定上限内等待子进程真实进入退出终态。 */
async function wait_for_process_exit(
  session: ShellSessionRuntimeState,
  timeout_ms: number,
): Promise<boolean> {
  let timeout_id: NodeJS.Timeout | undefined;
  const timeout_result = new Promise<boolean>((resolve) => {
    timeout_id = setTimeout(() => resolve(false), timeout_ms);
  });
  const completion_result = session.completion_promise.then(() => true);
  const process_exited = await Promise.race([completion_result, timeout_result]);
  if (timeout_id) clearTimeout(timeout_id);
  return process_exited;
}

/** 发送终止信号；句柄拒绝发送时返回 false。 */
function signal_process(
  session: ShellSessionRuntimeState,
  signal: "SIGTERM" | "SIGKILL",
): boolean {
  try {
    session.child.kill(signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * 终止仍在运行的子进程，并等待事件层确认资源已经退出。
 *
 * 关键点（中文）
 * - 默认策略是「先优雅、后强制」：SIGTERM 等不到退出就补发 SIGKILL。
 *   这是必需的两段式，而不是保守兜底：交互式 shell 对 SIGTERM 的忽略是
 *   标准行为，只发一次优雅信号等于对这类会话永远不生效。
 * - `force` 跳过优雅阶段，直接强制终止。
 * - 返回 `false` 仅表示平台句柄未在全部上限内确认退出，调用方必须将其作为
 *   生命周期失败处理。
 */
export async function terminate_shell_session_process(
  session: ShellSessionRuntimeState,
  force: boolean,
): Promise<boolean> {
  if (
    session.snapshot.status !== "running"
    && session.snapshot.status !== "starting"
  ) {
    return await wait_for_process_exit(session, FORCED_TERMINATION_WAIT_MS);
  }

  if (!force) {
    if (!signal_process(session, "SIGTERM")) return false;
    if (await wait_for_process_exit(session, GRACEFUL_TERMINATION_WAIT_MS)) return true;
  }

  if (!signal_process(session, "SIGKILL")) return false;
  return await wait_for_process_exit(session, FORCED_TERMINATION_WAIT_MS);
}
