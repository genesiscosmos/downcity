/**
 * Detached 进程信号工具。
 *
 * CLI City daemon 与本地 Federation 进程使用相同的跨平台进程组停止语义。
 */

import { execFileSync } from "node:child_process";

/** 判断指定 PID 是否仍然存在。 */
function is_process_alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 构建 detached 进程停机时的信号目标。
 *
 * POSIX 优先向进程组发送信号，再回退到单 PID；Windows 只支持单 PID。
 */
export function buildDetachedProcessSignalTargets(pid: number): number[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  if (process.platform === "win32") return [pid];
  return [-pid, pid];
}

/** 向 detached 进程或进程组发送停止信号。 */
export function signalDetachedProcess(
  pid: number,
  signal: NodeJS.Signals,
): boolean {
  if (process.platform === "win32") {
    try {
      const args = ["/pid", String(pid), "/t"];
      if (signal === "SIGKILL") args.push("/f");
      execFileSync("taskkill.exe", args, { stdio: "ignore", windowsHide: true });
      return true;
    } catch {
      return !is_process_alive(pid);
    }
  }
  for (const target of buildDetachedProcessSignalTargets(pid)) {
    try {
      process.kill(target, signal);
      return true;
    } catch {
      // 进程组不存在时继续尝试单 PID。
    }
  }
  return false;
}
