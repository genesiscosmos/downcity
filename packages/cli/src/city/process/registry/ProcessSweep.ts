/**
 * 孤儿进程清扫工具。
 *
 * 关键点（中文）
 * - 处理“pid 文件不存在，但旧的 detached 进程还活着”的场景。
 * - 仅匹配 Downcity CLI 自己拉起的 City 前台运行进程。
 * - 作为 stop/start 的兜底清理层，避免旧版本进程占住端口却无法被当前 pid 文件追踪。
 * - `run` 指 city runtime，`console run` 只用于清理旧 Console UI 进程。
 */

import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeCommand(command: string): string {
  return String(command || "").replace(/\s+/g, " ").trim();
}

/**
 * 构建 detached 进程停机时的信号目标。
 *
 * 关键点（中文）
 * - POSIX 下 `detached: true` 会让子进程成为新的进程组 leader。
 * - `-pid` 表示向整个进程组发信号，可覆盖 ACP、shell、watcher 等孙进程。
 * - Windows 不支持负 pid 进程组语义，只能回退到单 pid。
 */
export function buildDetachedProcessSignalTargets(pid: number): number[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  if (process.platform === "win32") return [pid];
  return [-pid, pid];
}

/**
 * 向 detached 进程发送信号。
 *
 * 关键点（中文）
 * - 优先发送到进程组；失败后再尝试单 pid。
 * - 返回值只表示至少有一个目标接收到了信号，不代表进程已经退出。
 */
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
      return !isProcessAlive(pid);
    }
  }
  for (const target of buildDetachedProcessSignalTargets(pid)) {
    try {
      process.kill(target, signal);
      return true;
    } catch {
      // 尝试下一个目标。
    }
  }
  return false;
}

function parseDowncityCliArgs(command: string): string | null {
  const normalized = normalizeCommand(command);
  const match = normalized.match(
    /(?:^|\s)(\S*[\\/]Index\.js)(?:\s+(.+)|$)/,
  );
  if (!match) return null;
  const entryPath = String(match[1] || "");
  const isKnownEntry =
    /[\\/]bin[\\/]cli[\\/]Index\.js$/.test(entryPath) ||
    /[\\/]bin[\\/]main[\\/]modules[\\/]cli[\\/]Index\.js$/.test(entryPath);
  if (!isKnownEntry) return null;

  const args = String(match[2] || "").trim();
  return args;
}

export function isDowncityCliCommand(command: string): boolean {
  return parseDowncityCliArgs(command) !== null;
}

/**
 * 判断命令行是否属于本次清扫目标。
 *
 * 关键点（中文）
 * - `Index.js run` 是 city runtime。
 * - `Index.js console run` 是旧 Console UI runtime。
 * - 两者都包含 `run`，因此必须按完整子命令匹配，不能只查 `run` 词元。
 */
export function shouldSweepDetachedBayCommand(
  command: string,
  params: {
    include_city_runtime?: boolean;
    include_legacy_console_ui?: boolean;
    include_agent?: boolean;
  },
): boolean {
  const args = parseDowncityCliArgs(command);
  if (args === null) return false;
  if (
    params.include_city_runtime &&
    /^run(?:\s|$)/.test(args)
  ) {
    return true;
  }
  if (
    params.include_legacy_console_ui &&
    /^console\s+run(?:\s|$)/.test(args)
  ) {
    return true;
  }
  if (
    params.include_agent &&
    /^agent\s+start(?:\s|$)/.test(args) &&
    /--foreground\s+true\b/.test(args)
  ) {
    return true;
  }
  return false;
}

async function listDetachedBayProcesses(params: {
  include_city_runtime?: boolean;
  include_legacy_console_ui?: boolean;
  include_agent?: boolean;
  excludePids: Set<number>;
}): Promise<Array<{ pid: number; command: string }>> {
  if (process.platform === "win32") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-axo", "pid=,command="],
      {
        maxBuffer: 1024 * 1024,
      },
    );

    return String(stdout || "")
      .split("\n")
      .map((line) => line.match(/^\s*(\d+)\s+(.*)$/))
      .filter((item): item is RegExpMatchArray => Boolean(item))
      .map((item) => ({
        pid: Number.parseInt(item[1] || "", 10),
        command: normalizeCommand(item[2] || ""),
      }))
      .filter((item) => Number.isInteger(item.pid) && item.pid > 0)
      .filter((item) => !params.excludePids.has(item.pid))
      .filter((item) => shouldSweepDetachedBayCommand(item.command, params));
  } catch {
    return [];
  }
}

/**
 * 只探测失联的 Downcity detached 进程，不执行停止动作。
 */
export async function findDetachedBayProcesses(params?: {
  include_city_runtime?: boolean;
  include_legacy_console_ui?: boolean;
  include_agent?: boolean;
  excludePids?: number[];
}): Promise<Array<{ pid: number; command: string }>> {
  const excludePids = new Set<number>([
    process.pid,
    ...(Array.isArray(params?.excludePids) ? params.excludePids : []),
  ]);

  return listDetachedBayProcesses({
    include_city_runtime: params?.include_city_runtime,
    include_legacy_console_ui: params?.include_legacy_console_ui,
    include_agent: params?.include_agent,
    excludePids,
  });
}

async function stopPid(pid: number, timeoutMs: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return true;

  if (!signalDetachedProcess(pid, "SIGTERM")) {
    return !isProcessAlive(pid);
  }

  const termStart = Date.now();
  while (Date.now() - termStart < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  try {
    if (isProcessAlive(pid)) {
      signalDetachedProcess(pid, "SIGKILL");
    }
  } catch {
    return !isProcessAlive(pid);
  }

  const killStart = Date.now();
  while (Date.now() - killStart < 2_000) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return !isProcessAlive(pid);
}

/**
 * 清扫失联的 Downcity detached 进程。
 */
export async function sweepDetachedBayProcesses(params?: {
  include_city_runtime?: boolean;
  include_legacy_console_ui?: boolean;
  include_agent?: boolean;
  timeoutMs?: number;
  excludePids?: number[];
}): Promise<{
  matched: Array<{ pid: number; command: string }>;
  stopped: Array<{ pid: number; command: string }>;
  alive: Array<{ pid: number; command: string }>;
}> {
  const timeoutMs = params?.timeoutMs ?? 8_000;
  const excludePids = new Set<number>([
    process.pid,
    ...(Array.isArray(params?.excludePids) ? params.excludePids : []),
  ]);
  const matched = await listDetachedBayProcesses({
    include_city_runtime: params?.include_city_runtime,
    include_legacy_console_ui: params?.include_legacy_console_ui,
    include_agent: params?.include_agent,
    excludePids,
  });

  const stopped: Array<{ pid: number; command: string }> = [];
  const alive: Array<{ pid: number; command: string }> = [];

  for (const item of matched) {
    // 关键点（中文）：逐个停止，避免并发 kill 时输出与状态难以对应。
    const ok = await stopPid(item.pid, timeoutMs);
    if (ok) {
      stopped.push(item);
    } else {
      alive.push(item);
    }
  }

  return {
    matched,
    stopped,
    alive,
  };
}
