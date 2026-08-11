/**
 * Shell 子进程终止生命周期。
 *
 * 关键点（中文）
 * - session 是子进程的唯一拥有者，终止操作必须等待真实 exit 事件后才能视为完成。
 * - 平台进程句柄可能延迟上报退出，因此等待必须有界，避免 dispose 永久阻塞。
 */

import type { ShellSessionRuntimeState } from "@/session/ShellRuntimeTypes.js";

const PROCESS_TERMINATION_WAIT_MS = 1_000;

/** 在固定上限内等待子进程真实进入退出终态。 */
async function wait_for_process_exit(
  session: ShellSessionRuntimeState,
): Promise<boolean> {
  let timeout_id: NodeJS.Timeout | undefined;
  const timeout_result = new Promise<boolean>((resolve) => {
    timeout_id = setTimeout(() => resolve(false), PROCESS_TERMINATION_WAIT_MS);
  });
  const completion_result = session.completionPromise.then(() => true);
  const process_exited = await Promise.race([completion_result, timeout_result]);
  if (timeout_id) clearTimeout(timeout_id);
  return process_exited;
}

/**
 * 终止仍在运行的子进程，并等待事件层确认资源已经退出。
 *
 * 返回 `false` 表示平台句柄未在上限内确认退出，调用方必须将其作为生命周期失败处理。
 */
export async function terminate_shell_session_process(
  session: ShellSessionRuntimeState,
  force: boolean,
): Promise<boolean> {
  if (
    session.snapshot.status !== "running"
    && session.snapshot.status !== "starting"
  ) {
    return await wait_for_process_exit(session);
  }

  try {
    session.child.kill(force ? "SIGKILL" : "SIGTERM");
  } catch {
    return false;
  }
  return await wait_for_process_exit(session);
}
