/**
 * 已安装 Node release 的进程控制与身份就绪检查。
 *
 * 启动器只接收 release 内相对入口，用 Node 直接执行；不使用源码启动脚本。
 * 子进程环境由独立运行配置与固定控制字段组成，不继承终端的任意秘密变量。
 */
import { closeSync, mkdirSync, openSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { signalDetachedProcess } from "@/city/process/registry/ProcessSweep.js";
import type { ServerProfile } from "@/federation/core/session.js";
import { CliError } from "@/shared/CliError.js";

/** 一次 release 启动所需的完整参数。 */
export interface LocalReleaseLaunch {
  /** 所属 Federation 的稳定 ID。 */
  fed_id: string;
  /** 本次已校验发布的 ID。 */
  release_id: string;
  /** 本次启动唯一身份。 */
  instance_id: string;
  /** 安装产物的绝对目录。 */
  release_dir: string;
  /** 产物内相对 JavaScript 入口。 */
  entry: string;
  /** 显式运行配置，不包含 CLI 控制的身份和端口。 */
  runtime_env: Record<string, string>;
  /** 监听地址。 */
  host: string;
  /** 固定监听端口。 */
  port: number;
  /** 对外管理 URL。 */
  base_url: string;
  /** 合并日志绝对路径。 */
  log_path: string;
}

/** Node 启动独立 release；launcher 本身由 CLI 提供，不读取源码项目。 */
export function start_release_process(input: LocalReleaseLaunch): number {
  mkdirSync(dirname(input.log_path), { recursive: true, mode: 0o700 });
  const log_fd = openSync(input.log_path, "a", 0o600);
  const launcher_path = fileURLToPath(new URL("../runtime/LocalProcessLauncher.js", import.meta.url));
  const base_env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "TZ"]) {
    if (process.env[key]) base_env[key] = process.env[key];
  }
  try {
    const child = spawn(process.execPath, [launcher_path,
      "--fed-id", input.fed_id,
      "--instance-id", input.instance_id,
      "--release-dir", input.release_dir,
      "--entry", input.entry,
    ], {
      cwd: input.release_dir,
      detached: true,
      env: {
        ...base_env,
        ...input.runtime_env,
        HOST: input.host,
        PORT: String(input.port),
        PUBLIC_URL: input.base_url,
        DOWNCITY_FEDERATION_BASE_URL: input.base_url,
        DOWNCITY_FED_ID: input.fed_id,
        DOWNCITY_RELEASE_ID: input.release_id,
        DOWNCITY_FED_INSTANCE_ID: input.instance_id,
      },
      stdio: ["ignore", log_fd, log_fd],
    });
    child.once("error", () => { /* 就绪检查结合进程存活与身份响应报告启动失败。 */ });
    child.unref();
    if (!child.pid) throw new Error("Unable to obtain release launcher PID");
    return child.pid;
  } finally { closeSync(log_fd); }
}

/** 判断进程是否存活；权限不足也视为存在，不接管未知进程。 */
export function is_local_process_alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** 停止已验证 launcher 的整个进程组，并等待退出；不触碰复用 PID 的程序。 */
export async function stop_release_process(server: ServerProfile | undefined): Promise<boolean> {
  if (!server || server.target !== "local" || !server.pid || !server.instance_id || !server.fed_id) return false;
  if (!is_local_process_alive(server.pid)) return true;
  if (!matches_launcher(server.pid, server.fed_id, server.instance_id)) {
    throw new CliError({ title: "Refusing to stop an unverified local process", note: `PID ${server.pid}` });
  }
  signalDetachedProcess(server.pid, "SIGTERM");
  await wait_for_exit(server.pid, 3_000);
  if (is_local_process_alive(server.pid)) {
    if (!matches_launcher(server.pid, server.fed_id, server.instance_id)) throw new Error("Process identity changed during shutdown");
    signalDetachedProcess(server.pid, "SIGKILL");
    await wait_for_exit(server.pid, 1_000);
  }
  return !is_local_process_alive(server.pid);
}

/** 只依据命令行中的精确参数匹配启动器身份，避免子串碰撞。 */
function matches_launcher(pid: number, fed_id: string, instance_id: string): boolean {
  try {
    const command = process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`], { encoding: "utf8" })
      : execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    const tokens = command.trim().split(/\s+/u);
    const fed_index = tokens.indexOf("--fed-id");
    const instance_index = tokens.indexOf("--instance-id");
    return command.includes("LocalProcessLauncher") && tokens[fed_index + 1] === fed_id
      && fed_index >= 0 && instance_index >= 0 && tokens[instance_index + 1] === instance_id;
  } catch { return false; }
}

/** 等待 PID 退出，不持有超过十毫秒级的同步阻塞。 */
async function wait_for_exit(pid: number, timeout_ms: number): Promise<void> {
  const deadline = Date.now() + timeout_ms;
  while (is_local_process_alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
}

/** 请求本次启动的就绪身份，拒绝旧服务或其他版本的成功响应。 */
export async function wait_for_release_ready(server: ServerProfile, timeout_ms = 15_000): Promise<void> {
  if (!server.fed_id || !server.release_id || !server.instance_id || !server.pid) {
    throw new CliError({ title: "Release identity is incomplete" });
  }
  const deadline = Date.now() + timeout_ms;
  let detail = "No matching ready response";
  while (Date.now() < deadline) {
    if (!is_local_process_alive(server.pid)) throw new Error("Release launcher exited before becoming ready");
    try {
      const response = await fetch(`${server.base_url.replace(/\/+$/u, "")}/health`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, deadline - Date.now()))), redirect: "manual",
      });
      if (!response.ok) { detail = `Health HTTP ${response.status}`; await response.body?.cancel(); }
      else {
        const health = await response.json() as Record<string, unknown>;
        if (health.ok === true && health.fed_id === server.fed_id && health.release_id === server.release_id
          && health.instance_id === server.instance_id && is_local_process_alive(server.pid)) return;
        detail = "Health response does not match this Federation, release and instance, or is not ready";
      }
    } catch { detail = "Health request failed or timed out"; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(detail);
}
