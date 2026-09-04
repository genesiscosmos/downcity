/**
 * CLI City daemon 的唯一进程管理器。
 *
 * 状态固定保存到 `~/.downcity/runtimes/city/`。启动和停止均通过 City RPC
 * 核对 PID 与 instance_id，避免历史文件或 PID 复用导致误判、误杀。
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
import fs from "fs-extra";
import { get_city_daemon_runtime_dir_path } from "@/city/process/registry/CityPaths.js";
import {
  DAEMON_LOG_FILENAME,
  DAEMON_META_FILENAME,
  DAEMON_PID_FILENAME,
  type DaemonMeta,
  type DaemonStaleReason,
} from "@/city/process/daemon/Types.js";
import { signalDetachedProcess } from "@/city/process/registry/ProcessSweep.js";

const READY_TIMEOUT_MS = 15_000;
const RPC_TIMEOUT_MS = 800;

/** City daemon pid 文件路径。 */
export function get_daemon_pid_path(): string {
  return path.join(get_city_daemon_runtime_dir_path(), DAEMON_PID_FILENAME);
}

/** City daemon 日志文件路径。 */
export function get_daemon_log_path(): string {
  return path.join(get_city_daemon_runtime_dir_path(), DAEMON_LOG_FILENAME);
}

/** City daemon 元数据路径。 */
export function get_daemon_meta_path(): string {
  return path.join(get_city_daemon_runtime_dir_path(), DAEMON_META_FILENAME);
}

/** 宽松读取 daemon pid。 */
export async function read_daemon_pid(): Promise<number | null> {
  try {
    const pid = Number.parseInt((await fs.readFile(get_daemon_pid_path(), "utf8")).trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** 检查进程是否仍存活。 */
export function is_process_alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 宽松读取并校验 City daemon 元数据。 */
export async function read_daemon_meta(): Promise<DaemonMeta | null> {
  try {
    const value = await fs.readJson(get_daemon_meta_path()) as Partial<DaemonMeta>;
    if (!Number.isInteger(value.pid) || Number(value.pid) <= 0) return null;
    if (!String(value.instance_id || "").trim()) return null;
    if (!String(value.started_at || "").trim()) return null;
    if (!String(value.host || "").trim() || !String(value.rpc_host || "").trim()) return null;
    if (!valid_port(value.http_port) || !valid_port(value.rpc_port)) return null;
    if (!Array.isArray(value.agent_ids)) return null;
    if (!String(value.command || "").trim() || !Array.isArray(value.args)) return null;
    return value as DaemonMeta;
  } catch {
    return null;
  }
}

/** 清理已经失效的 City daemon pid/meta 文件。 */
export async function cleanup_stale_daemon_files(): Promise<void> {
  const pid = await read_daemon_pid();
  if (pid && is_process_alive(pid)) return;
  await Promise.all([
    fs.remove(get_daemon_pid_path()),
    fs.remove(get_daemon_meta_path()),
  ]);
}

/** 仅由当前 daemon 实例删除自己的 pid/meta 文件。 */
export async function unregister_current_daemon_process(): Promise<void> {
  const instance_id = String(process.env.DOWNCITY_DAEMON_INSTANCE_ID || "").trim();
  if (!instance_id) return;
  const [pid, meta] = await Promise.all([read_daemon_pid(), read_daemon_meta()]);
  if (pid !== process.pid || meta?.pid !== process.pid || meta.instance_id !== instance_id) return;
  await Promise.all([
    fs.remove(get_daemon_pid_path()),
    fs.remove(get_daemon_meta_path()),
  ]);
}

/** 诊断 City daemon stale 状态。 */
export async function diagnose_daemon_stale_reasons(): Promise<DaemonStaleReason[]> {
  const reasons: DaemonStaleReason[] = [];
  const pid = await read_daemon_pid();
  if (pid && !is_process_alive(pid)) {
    reasons.push({ code: "process_not_alive", message: "pid file exists but process is not alive" });
  }
  if (!(await fs.pathExists(get_daemon_meta_path()))) {
    reasons.push({ code: "meta_missing", message: "daemon meta file is missing" });
    return reasons;
  }
  const meta = await read_daemon_meta();
  if (!meta) {
    reasons.push({ code: "meta_invalid", message: "daemon meta file is invalid" });
    return reasons;
  }
  if (pid && meta.pid !== pid) {
    reasons.push({ code: "meta_pid_mismatch", message: "pid and daemon meta disagree" });
  }
  return reasons;
}

/** 后台启动唯一 City daemon。 */
export async function start_daemon_process(input: {
  /** 编译后的 CLI 入口。 */
  cli_path: string;
  /** 前台 City 参数。 */
  args: string[];
  /** HTTP 监听地址。 */
  host: string;
  /** HTTP 端口。 */
  http_port: number;
  /** RPC 端口。 */
  rpc_port: number;
  /** 本次恢复的 Agent ID。 */
  agent_ids: string[];
}): Promise<{ pid: number; log_path: string }> {
  await fs.ensureDir(get_city_daemon_runtime_dir_path());
  await cleanup_stale_daemon_files();
  const existing_pid = await read_daemon_pid();
  if (existing_pid && is_process_alive(existing_pid)) {
    throw new Error(`City daemon already running (pid: ${existing_pid})`);
  }

  const instance_id = randomUUID();
  const log_path = get_daemon_log_path();
  const log_fd = fs.openSync(log_path, "a");
  const child = spawn(process.execPath, [input.cli_path, ...input.args], {
    cwd: get_city_daemon_runtime_dir_path(),
    detached: true,
    stdio: ["ignore", log_fd, log_fd],
    env: {
      ...process.env,
      DOWNCITY_DAEMON: "1",
      DOWNCITY_DAEMON_INSTANCE_ID: instance_id,
    },
  });
  child.unref();
  fs.closeSync(log_fd);
  if (!child.pid) throw new Error("Failed to start City daemon: missing pid");

  const meta: DaemonMeta = {
    pid: child.pid,
    instance_id,
    started_at: new Date().toISOString(),
    host: input.host,
    http_port: input.http_port,
    rpc_host: "127.0.0.1",
    rpc_port: input.rpc_port,
    agent_ids: [...input.agent_ids].sort(),
    command: process.execPath,
    args: [input.cli_path, ...input.args],
    node: process.version,
    platform: process.platform,
  };
  await fs.writeFile(get_daemon_pid_path(), `${child.pid}\n`, "utf8");
  await fs.writeJson(get_daemon_meta_path(), meta, { spaces: 2 });

  try {
    await wait_for_daemon_ready(meta);
  } catch (error) {
    if (is_process_alive(child.pid)) signalDetachedProcess(child.pid, "SIGTERM");
    await Promise.all([fs.remove(get_daemon_pid_path()), fs.remove(get_daemon_meta_path())]);
    throw new Error(`${error instanceof Error ? error.message : String(error)}. Check ${log_path}`);
  }
  return { pid: child.pid, log_path };
}

/** 停止唯一 City daemon。 */
export async function stop_daemon_process(timeout_ms = 10_000): Promise<{
  stopped: boolean;
  pid?: number;
}> {
  const pid = await read_daemon_pid();
  if (!pid) return { stopped: false };
  if (!is_process_alive(pid)) {
    await cleanup_stale_daemon_files();
    return { stopped: false, pid };
  }
  const meta = await read_daemon_meta();
  if (!meta || meta.pid !== pid) {
    throw new Error("City daemon identity is unavailable; refusing to signal the process");
  }
  const identity = await read_runtime_identity(meta);
  if (!identity || identity.pid !== pid || identity.instance_id !== meta.instance_id) {
    throw new Error("City daemon identity mismatch; refusing to signal the process");
  }

  signalDetachedProcess(pid, "SIGTERM");
  const started_at = Date.now();
  while (Date.now() - started_at < timeout_ms && is_process_alive(pid)) {
    await sleep(200);
  }
  if (is_process_alive(pid)) signalDetachedProcess(pid, "SIGKILL");
  await Promise.all([fs.remove(get_daemon_pid_path()), fs.remove(get_daemon_meta_path())]);
  return { stopped: true, pid };
}

/** 读取 RPC 返回的 daemon 实例身份。 */
async function read_runtime_identity(meta: DaemonMeta): Promise<{
  pid: number;
  instance_id: string;
} | null> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: meta.rpc_host, port: meta.rpc_port });
    let buffered = "";
    let settled = false;
    const finish = (value: { pid: number; instance_id: string } | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(RPC_TIMEOUT_MS);
    socket.once("connect", () => socket.write(`${JSON.stringify({
      id: `city-status-${randomUUID()}`,
      method: "internal.city.status",
    })}\n`));
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const newline_index = buffered.indexOf("\n");
      if (newline_index < 0) return;
      try {
        const frame = JSON.parse(buffered.slice(0, newline_index)) as {
          success?: unknown;
          data?: { pid?: unknown; instance_id?: unknown };
        };
        if (frame.success !== true) return finish(null);
        finish({
          pid: Number(frame.data?.pid),
          instance_id: String(frame.data?.instance_id || ""),
        });
      } catch {
        finish(null);
      }
    });
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
    socket.once("close", () => finish(null));
  });
}

/** 等待 daemon 完成 RPC 监听和身份注册。 */
async function wait_for_daemon_ready(meta: DaemonMeta): Promise<void> {
  const started_at = Date.now();
  while (Date.now() - started_at < READY_TIMEOUT_MS) {
    if (!is_process_alive(meta.pid)) throw new Error("City daemon exited before becoming ready");
    const identity = await read_runtime_identity(meta);
    if (identity?.pid === meta.pid && identity.instance_id === meta.instance_id) return;
    await sleep(200);
  }
  throw new Error(`City daemon RPC did not become ready at ${meta.rpc_host}:${meta.rpc_port}`);
}

/** 校验端口。 */
function valid_port(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65_535;
}

/** 异步等待。 */
async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
