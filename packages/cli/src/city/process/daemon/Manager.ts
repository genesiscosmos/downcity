/**
 * Downcity daemon 管理（PID / 日志 / 启停）。
 *
 * 目标
 * - `city agent start`：后台启动（终端退出后仍运行）
 * - `city agent restart`：重启后台进程
 *
 * 约定
 * - 所有 daemon 相关文件都写入 `.downcity/debug/`，便于排查：
 *   - `downcity.pid`：进程 pid
 *   - `downcity.daemon.log`：stdout/stderr 合并日志
 *   - `downcity.daemon.json`：元数据（启动时间、参数等）
 */

import fs from "fs-extra";
import path from "path";
import { spawn } from "child_process";
import { execFile as execFileCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { getDowncityDebugDirPath } from "@/city/config/Paths.js";
import {
  DAEMON_LOG_FILENAME,
  DAEMON_META_FILENAME,
  DAEMON_PID_FILENAME,
  type DaemonMeta,
  type DaemonRuntimeIdentity,
  type DaemonStaleReason,
} from "@/city/process/daemon/Types.js";
import {
  markManagedAgentStopped,
  upsertManagedAgentEntry,
} from "@/city/process/registry/CityRegistry.js";
import { signalDetachedProcess } from "@/city/process/registry/ProcessSweep.js";
import { mergeProcessEnvWithPlatformGlobalEnv } from "@/city/env/ProcessEnv.js";

/**
 * 异步睡眠工具。
 */
const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const DAEMON_READY_TIMEOUT_MS = 15_000;
const DAEMON_READY_CONNECT_TIMEOUT_MS = 300;
const DAEMON_READY_POLL_INTERVAL_MS = 200;
const execFileAsync = promisify(execFileCb);

/**
 * 计算 daemon pid 文件路径。
 */
export const getDaemonPidPath = (project_root: string): string =>
  path.join(getDowncityDebugDirPath(project_root), DAEMON_PID_FILENAME);

/**
 * 计算 daemon 日志文件路径。
 */
export const getDaemonLogPath = (project_root: string): string =>
  path.join(getDowncityDebugDirPath(project_root), DAEMON_LOG_FILENAME);

/**
 * 计算 daemon 元数据文件路径。
 */
export const getDaemonMetaPath = (project_root: string): string =>
  path.join(getDowncityDebugDirPath(project_root), DAEMON_META_FILENAME);

/**
 * 读取 daemon pid。
 *
 * 关键点（中文）
 * - 读取失败或内容非法统一返回 `null`，调用方走无进程分支。
 */
export const readDaemonPid = async (
  project_root: string,
): Promise<number | null> => {
  try {
    const raw = await fs.readFile(getDaemonPidPath(project_root), "utf-8");
    const pid = Number.parseInt(String(raw).trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

/**
 * 检查进程是否存活。
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * 读取 daemon meta（宽松模式）。
 *
 * 关键点（中文）
 * - 返回 null 表示文件缺失、解析失败或结构非法。
 * - 该函数用于状态展示，不抛异常。
 */
export const readDaemonMeta = async (
  project_root: string,
): Promise<DaemonMeta | null> => {
  try {
    const value = await fs.readJson(getDaemonMetaPath(project_root));
    const pid = Number((value as { pid?: unknown })?.pid);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    const startedAt = String(
      (value as { startedAt?: unknown })?.startedAt || "",
    ).trim();
    if (!startedAt) return null;
    const command = String(
      (value as { command?: unknown })?.command || "",
    ).trim();
    const project = String(
      (value as { project_root?: unknown })?.project_root || "",
    ).trim();
    const instance_id = String(
      (value as { instance_id?: unknown })?.instance_id || "",
    ).trim();
    if (!command || !project || !instance_id) return null;
    return value as DaemonMeta;
  } catch {
    return null;
  }
};

/**
 * 诊断 stale 原因。
 */
export const diagnoseDaemonStaleReasons = async (
  project_root: string,
  pid: number,
): Promise<DaemonStaleReason[]> => {
  const reasons: DaemonStaleReason[] = [];
  reasons.push({
    code: "process_not_alive",
    message: "pid file exists but process is not alive",
  });

  const metaPath = getDaemonMetaPath(project_root);
  const metaExists = await fs.pathExists(metaPath);
  if (!metaExists) {
    reasons.push({
      code: "meta_missing",
      message: "daemon meta file is missing",
    });
    return reasons;
  }

  try {
    await fs.readJson(metaPath);
  } catch {
    reasons.push({
      code: "meta_invalid",
      message: "daemon meta file is invalid JSON",
    });
    return reasons;
  }

  const parsedMeta = await readDaemonMeta(project_root);
  if (!parsedMeta) {
    const raw_meta = await fs.readJson(metaPath).catch(() => null) as { instance_id?: unknown } | null;
    if (!String(raw_meta?.instance_id || "").trim()) {
      reasons.push({
        code: "meta_instance_missing",
        message: "daemon meta file is missing instance_id",
      });
    }
    reasons.push({
      code: "meta_invalid",
      message: "daemon meta file has invalid structure",
    });
    return reasons;
  }

  if (parsedMeta.pid !== pid) {
    reasons.push({
      code: "meta_pid_mismatch",
      message: `meta pid (${parsedMeta.pid}) does not match pid file (${pid})`,
    });
  }

  const metaProjectRoot = path.resolve(String(parsedMeta.project_root || ""));
  const expectedProjectRoot = path.resolve(project_root);
  if (metaProjectRoot !== expectedProjectRoot) {
    reasons.push({
      code: "meta_project_mismatch",
      message: `meta project root mismatch (${metaProjectRoot})`,
    });
  }

  return reasons;
};

/**
 * 清理僵尸 daemon 标记文件。
 *
 * 算法（中文）
 * - 若 pid 文件存在但进程不存在，移除 pid/meta，恢复可重启状态。
 */
export const cleanupStaleDaemonFiles = async (
  project_root: string,
): Promise<void> => {
  const pid = await readDaemonPid(project_root);
  if (!pid) return;
  if (isProcessAlive(pid)) return;

  // 关键注释：pid 文件存在但进程已退出，属于“脏状态”，这里直接清理。
  await fs.remove(getDaemonPidPath(project_root));
  await fs.remove(getDaemonMetaPath(project_root));
  // 关键点（中文）：僵尸 daemon 清理时标记 stopped，保留历史记录。
  try {
    await markManagedAgentStopped(project_root);
  } catch {
    // ignore registry sync errors
  }
};

/**
 * 写入 daemon pid 与元数据文件。
 */
export const writeDaemonFiles = async (
  project_root: string,
  meta: DaemonMeta,
): Promise<void> => {
  await fs.ensureDir(getDowncityDebugDirPath(project_root));
  await fs.writeFile(getDaemonPidPath(project_root), String(meta.pid), "utf-8");
  await fs.writeJson(getDaemonMetaPath(project_root), meta, { spaces: 2 });
};

/**
 * 读取 CLI 参数值。
 *
 * 关键点（中文）
 * - 支持 `--key value` 与 `--key=value` 两种形态，便于后续 CLI 参数格式演进。
 */
function pickArgValue(args: string[], key: string): string | undefined {
  const inlinePrefix = `${key}=`;
  const inlineValue = args
    .map((item) => String(item).trim())
    .find((item) => item.startsWith(inlinePrefix));
  if (inlineValue) {
    const value = inlineValue.slice(inlinePrefix.length).trim();
    return value || undefined;
  }

  const idx = args.findIndex((item) => String(item).trim() === key);
  if (idx < 0) return undefined;
  const next = String(args[idx + 1] || "").trim();
  return next || undefined;
}

/**
 * 解析端口值。
 */
function parsePortLike(input: string | number | undefined): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const raw =
    typeof input === "number" ? input : Number.parseInt(String(input), 10);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return undefined;
  if (!Number.isInteger(raw) || raw <= 0 || raw > 65535) return undefined;
  return raw;
}

/**
 * 通过本机 RPC 读取 daemon 运行身份。
 *
 * 关键点（中文）
 * - 必须收到 internal.status.get 的完整身份，单纯端口可连接不代表目标 daemon 正确。
 */
async function read_daemon_runtime_identity(params: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<DaemonRuntimeIdentity | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buffered = "";
    const finish = (identity: DaemonRuntimeIdentity | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(identity);
    };

    const socket = createConnection({
      host: params.host,
      port: params.port,
    });
    socket.setTimeout(params.timeoutMs ?? DAEMON_READY_CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id: "daemon-identity", method: "internal.status.get" })}\n`);
    });
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const newline_index = buffered.indexOf("\n");
      if (newline_index < 0) return;
      try {
        const frame = JSON.parse(buffered.slice(0, newline_index)) as {
          success?: unknown;
          data?: Partial<DaemonRuntimeIdentity>;
        };
        const data = frame.data;
        const pid = Number(data?.pid);
        const project_root = String(data?.project_root || "").trim();
        const instance_id = String(data?.instance_id || "").trim();
        finish(frame.success === true && Number.isInteger(pid) && pid > 0 && project_root && instance_id
          ? { pid, project_root, instance_id }
          : null);
      } catch {
        finish(null);
      }
    });
    socket.once("error", () => finish(null));
    socket.once("timeout", () => finish(null));
  });
}

/** 判断 RPC 返回身份是否与 daemon meta 完全一致。 */
function daemon_identity_matches(
  meta: Pick<DaemonMeta, "pid" | "project_root" | "instance_id">,
  identity: DaemonRuntimeIdentity,
): boolean {
  return identity.pid === meta.pid
    && path.resolve(identity.project_root) === path.resolve(meta.project_root)
    && identity.instance_id === meta.instance_id;
}

/** 读取指定 PID 的操作系统命令行。 */
async function read_process_command(pid: number): Promise<string | null> {
  if (process.platform === "win32") return null;
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    return String(stdout || "").replace(/\s+/g, " ").trim() || null;
  } catch {
    return null;
  }
}

/** 读取 daemon 进程环境中的实例 ID，作为 RPC 失联时的强身份凭据。 */
async function read_process_instance_id(pid: number): Promise<string | null> {
  if (process.platform === "win32") return null;
  try {
    if (process.platform === "linux") {
      const environ = await fs.readFile(`/proc/${pid}/environ`, "utf8");
      const entry = environ.split("\0")
        .find((item) => item.startsWith("DOWNCITY_DAEMON_INSTANCE_ID="));
      return entry?.slice("DOWNCITY_DAEMON_INSTANCE_ID=".length).trim() || null;
    }
    const { stdout } = await execFileAsync("ps", ["eww", "-p", String(pid), "-o", "command="]);
    const match = String(stdout || "").match(/(?:^|\s)DOWNCITY_DAEMON_INSTANCE_ID=([^\s]+)/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

/** RPC 失联时，严格确认 OS 命令行属于 meta 描述的当前项目 daemon。 */
async function command_matches_daemon_meta(meta: DaemonMeta): Promise<boolean> {
  const [command, instance_id] = await Promise.all([
    read_process_command(meta.pid),
    read_process_instance_id(meta.pid),
  ]);
  if (!command || instance_id !== meta.instance_id) return false;
  const cli_path = path.resolve(String(meta.args[0] || ""));
  return Boolean(cli_path)
    && command.includes(cli_path)
    && command.includes("agent start")
    && command.includes("--foreground true")
    && command.includes(path.resolve(meta.project_root));
}

/**
 * 等待 daemon RPC 进入可连接状态。
 */
async function waitForDaemonReady(params: {
  pid: number;
  project_root: string;
  instance_id: string;
  args: string[];
  timeoutMs?: number;
}): Promise<void> {
  const rpc_port = parsePortLike(pickArgValue(params.args, "--rpc-port"));
  if (!rpc_port) {
    throw new Error("Daemon RPC port is missing from startup arguments");
  }

  // 关键点（中文）：Agent RPC 在前台运行入口固定监听本机地址，不能复用 HTTP gateway host。
  const rpc_host = "127.0.0.1";
  const timeout_ms = params.timeoutMs ?? DAEMON_READY_TIMEOUT_MS;
  const started_at = Date.now();

  while (Date.now() - started_at < timeout_ms) {
    if (!isProcessAlive(params.pid)) {
      throw new Error(
        `Daemon process exited before RPC became ready (${rpc_host}:${rpc_port})`,
      );
    }

    const identity = await read_daemon_runtime_identity({ host: rpc_host, port: rpc_port });
    if (identity && daemon_identity_matches({
      pid: params.pid,
      instance_id: params.instance_id,
      project_root: params.project_root,
    }, identity)) {
      return;
    }

    await sleep(DAEMON_READY_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Daemon RPC did not become ready at ${rpc_host}:${rpc_port} within ${timeout_ms}ms`,
  );
}

/**
 * 回滚启动失败状态。
 */
async function rollback_daemon_startup(params: {
  project_root: string;
  pid: number;
  instance_id: string;
}): Promise<void> {
  const read_owned_meta = async (): Promise<DaemonMeta | null> => {
    const meta = await readDaemonMeta(params.project_root);
    return meta
      && meta.pid === params.pid
      && meta.instance_id === params.instance_id
      && path.resolve(meta.project_root) === path.resolve(params.project_root)
      ? meta
      : null;
  };
  const confirm_process = async (meta: DaemonMeta): Promise<boolean> => {
    if (!isProcessAlive(meta.pid)) return false;
    const rpc_port = parsePortLike(pickArgValue(meta.args, "--rpc-port"));
    const identity = rpc_port
      ? await read_daemon_runtime_identity({ host: "127.0.0.1", port: rpc_port })
      : null;
    return identity
      ? daemon_identity_matches(meta, identity)
      : await command_matches_daemon_meta(meta);
  };

  const initial_meta = await read_owned_meta();
  if (initial_meta && await confirm_process(initial_meta)) {
    signalDetachedProcess(params.pid, "SIGTERM");
    await sleep(300);
    const kill_meta = await read_owned_meta();
    if (kill_meta && await confirm_process(kill_meta)) {
      signalDetachedProcess(params.pid, "SIGKILL");
    }
  }

  // 只有文件仍描述本次启动实例时才清理，避免覆盖并发启动的新 daemon 状态。
  if (!await read_owned_meta()) return;
  await fs.remove(getDaemonPidPath(params.project_root));
  await fs.remove(getDaemonMetaPath(params.project_root));
  try {
    await markManagedAgentStopped(params.project_root);
  } catch {
    // ignore registry sync errors
  }
}

/**
 * 启动 daemon 子进程。
 *
 * 流程（中文）
 * 1) 清理脏 pid/meta
 * 2) 检查是否已有存活 daemon
 * 3) detached + unref 拉起 `node cli.js run ...`
 * 4) 写入 pid/meta 供 stop/restart 使用
 */
export const startDaemonProcess = async (params: {
  project_root: string;
  cliPath: string;
  args: string[];
}): Promise<{ pid: number; logPath: string }> => {
  const { project_root, cliPath, args } = params;
  const instance_id = randomUUID();

  await fs.ensureDir(getDowncityDebugDirPath(project_root));
  await cleanupStaleDaemonFiles(project_root);

  const existingPid = await readDaemonPid(project_root);
  if (existingPid && isProcessAlive(existingPid)) {
    const existing_meta = await readDaemonMeta(project_root);
    const existing_rpc_port = existing_meta
      ? parsePortLike(pickArgValue(existing_meta.args, "--rpc-port"))
      : undefined;
    const existing_identity = existing_rpc_port
      ? await read_daemon_runtime_identity({ host: "127.0.0.1", port: existing_rpc_port })
      : null;
    const confirmed_existing = Boolean(
      existing_meta
      && existing_meta.pid === existingPid
      && path.resolve(existing_meta.project_root) === path.resolve(project_root)
      && (existing_identity
        ? daemon_identity_matches(existing_meta, existing_identity)
        : await command_matches_daemon_meta(existing_meta)),
    );
    if (confirmed_existing) {
      throw new Error(`Daemon already running (pid: ${existingPid})`);
    }
    await fs.remove(getDaemonPidPath(project_root));
    await fs.remove(getDaemonMetaPath(project_root));
  }

  const logPath = getDaemonLogPath(project_root);
  const logFd = fs.openSync(logPath, "a");

  const childEnv: NodeJS.ProcessEnv = {
    ...mergeProcessEnvWithPlatformGlobalEnv(process.env),
    DOWNCITY_DAEMON: "1",
    DOWNCITY_DAEMON_INSTANCE_ID: instance_id,
  };

  // 关键注释：daemon 进程必须 detached + unref 才能在父进程退出后继续运行。
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: project_root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: childEnv,
  });

  child.unref();

  if (!child.pid) {
    fs.closeSync(logFd);
    throw new Error("Failed to start daemon process (missing pid)");
  }

  await writeDaemonFiles(project_root, {
    pid: child.pid,
    instance_id,
    project_root,
    startedAt: new Date().toISOString(),
    command: process.execPath,
    args: [cliPath, ...args],
    node: process.version,
    platform: process.platform,
  });

  // 关键点（中文）：只有 RPC 端口可连接后，才把 daemon 视为真正启动成功。
  try {
    await waitForDaemonReady({
      pid: child.pid,
      project_root,
      instance_id,
      args,
    });

    // 关键点（中文）：启动成功后必须登记到 managed agent registry，否则该 daemon 视为“无效启动”。
    await upsertManagedAgentEntry({
      project_root,
      pid: child.pid,
      status: "running",
    });
  } catch (error) {
    // 回滚：无法 ready 或无法登记时立即停止 daemon 并清理状态文件。
    await rollback_daemon_startup({
      project_root,
      pid: child.pid,
      instance_id,
    });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}. Check daemon log: ${logPath}`);
  }

  return { pid: child.pid, logPath };
};

/**
 * 停止 daemon 子进程。
 *
 * 策略（中文）
 * - 先发 `SIGTERM` 做优雅退出；超时后回退 `SIGKILL`。
 * - 无论 stop 结果如何，最终清理 pid/meta，避免状态残留。
 */
export const stopDaemonProcess = async (params: {
  project_root: string;
  timeoutMs?: number;
}): Promise<{ stopped: boolean; pid?: number }> => {
  const { project_root, timeoutMs = 10_000 } = params;

  await cleanupStaleDaemonFiles(project_root);
  const pid = await readDaemonPid(project_root);
  if (!pid) return { stopped: false };

  if (!isProcessAlive(pid)) {
    await fs.remove(getDaemonPidPath(project_root));
    await fs.remove(getDaemonMetaPath(project_root));
    return { stopped: false, pid };
  }

  const meta = await readDaemonMeta(project_root);
  if (
    !meta
    || meta.pid !== pid
    || path.resolve(meta.project_root) !== path.resolve(project_root)
  ) {
    await fs.remove(getDaemonPidPath(project_root));
    await fs.remove(getDaemonMetaPath(project_root));
    return { stopped: false, pid };
  }

  const rpc_port = parsePortLike(pickArgValue(meta.args, "--rpc-port"));
  const identity = rpc_port
    ? await read_daemon_runtime_identity({ host: "127.0.0.1", port: rpc_port })
    : null;
  const confirmed = identity
    ? daemon_identity_matches(meta, identity)
    : await command_matches_daemon_meta(meta);
  if (!confirmed) {
    await fs.remove(getDaemonPidPath(project_root));
    await fs.remove(getDaemonMetaPath(project_root));
    return { stopped: false, pid };
  }

  signalDetachedProcess(pid, "SIGTERM");

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) break;
    await sleep(200);
  }

  if (isProcessAlive(pid)) {
    // 关键注释：尽量优雅停止，超时后再强杀，避免后台进程“卡死”。
    try {
      signalDetachedProcess(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }

  await fs.remove(getDaemonPidPath(project_root));
  await fs.remove(getDaemonMetaPath(project_root));
  // 关键点（中文）：停止后标记为 stopped，保留历史记录。
  try {
    await markManagedAgentStopped(project_root);
  } catch {
    // ignore registry sync errors
  }

  return { stopped: true, pid };
};
