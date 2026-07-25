/**
 * Downcity daemon 管理（PID / 日志 / 启停）。
 *
 * 目标
 * - `city agent start`：后台启动（终端退出后仍运行）
 * - `city agent restart`：重启后台进程
 *
 * 约定
 * - 所有 daemon 状态写入 `~/.downcity/runtimes/<agent_id>/`。
 * - Workspace 不保存进程状态；同一路径绑定多个 Agent 时仍可独立管理。
 */

import fs from "fs-extra";
import path from "path";
import { spawn } from "child_process";
import { execFile as execFileCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { get_agent_runtime_dir_path } from "@/city/process/registry/CityPaths.js";
import {
  DAEMON_LOG_FILENAME,
  DAEMON_META_FILENAME,
  DAEMON_PID_FILENAME,
  type DaemonTarget,
  type DaemonMeta,
  type DaemonRuntimeIdentity,
  type DaemonStaleReason,
} from "@/city/process/daemon/Types.js";
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
export const getDaemonPidPath = (agent_id: string): string =>
  path.join(get_agent_runtime_dir_path(agent_id), DAEMON_PID_FILENAME);

/**
 * 计算 daemon 日志文件路径。
 */
export const getDaemonLogPath = (agent_id: string): string =>
  path.join(get_agent_runtime_dir_path(agent_id), DAEMON_LOG_FILENAME);

/**
 * 计算 daemon 元数据文件路径。
 */
export const getDaemonMetaPath = (agent_id: string): string =>
  path.join(get_agent_runtime_dir_path(agent_id), DAEMON_META_FILENAME);

/**
 * 读取 daemon pid。
 *
 * 关键点（中文）
 * - 读取失败或内容非法统一返回 `null`，调用方走无进程分支。
 */
export const readDaemonPid = async (
  agent_id: string,
): Promise<number | null> => {
  try {
    const raw = await fs.readFile(getDaemonPidPath(agent_id), "utf-8");
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
  agent_id: string,
): Promise<DaemonMeta | null> => {
  try {
    const value = await fs.readJson(getDaemonMetaPath(agent_id));
    const pid = Number((value as { pid?: unknown })?.pid);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    const started_at = String(
      (value as { started_at?: unknown })?.started_at || "",
    ).trim();
    if (!started_at) return null;
    const command = String(
      (value as { command?: unknown })?.command || "",
    ).trim();
    const stored_agent_id = String(
      (value as { agent_id?: unknown })?.agent_id || "",
    ).trim();
    const workspace_path = String(
      (value as { workspace_path?: unknown })?.workspace_path || "",
    ).trim();
    const instance_id = String(
      (value as { instance_id?: unknown })?.instance_id || "",
    ).trim();
    if (!command || stored_agent_id !== agent_id || !workspace_path || !instance_id) return null;
    return value as DaemonMeta;
  } catch {
    return null;
  }
};

/**
 * 诊断 stale 原因。
 */
export const diagnoseDaemonStaleReasons = async (
  target: DaemonTarget,
  pid: number,
): Promise<DaemonStaleReason[]> => {
  const reasons: DaemonStaleReason[] = [];
  reasons.push({
    code: "process_not_alive",
    message: "pid file exists but process is not alive",
  });

  const metaPath = getDaemonMetaPath(target.agent_id);
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

  const parsedMeta = await readDaemonMeta(target.agent_id);
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

  if (parsedMeta.agent_id !== target.agent_id) {
    reasons.push({
      code: "meta_agent_mismatch",
      message: `meta agent id mismatch (${parsedMeta.agent_id})`,
    });
  }

  const meta_workspace_path = path.resolve(parsedMeta.workspace_path);
  const expected_workspace_path = path.resolve(target.workspace_path);
  if (meta_workspace_path !== expected_workspace_path) {
    reasons.push({
      code: "meta_workspace_mismatch",
      message: `meta workspace path mismatch (${meta_workspace_path})`,
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
  agent_id: string,
): Promise<void> => {
  const pid = await readDaemonPid(agent_id);
  if (!pid) return;
  if (isProcessAlive(pid)) return;

  // 关键注释：pid 文件存在但进程已退出，属于“脏状态”，这里直接清理。
  await fs.remove(getDaemonPidPath(agent_id));
  await fs.remove(getDaemonMetaPath(agent_id));
};

/**
 * 写入 daemon pid 与元数据文件。
 */
export const writeDaemonFiles = async (
  agent_id: string,
  meta: DaemonMeta,
): Promise<void> => {
  await fs.ensureDir(get_agent_runtime_dir_path(agent_id));
  await fs.writeFile(getDaemonPidPath(agent_id), String(meta.pid), "utf-8");
  await fs.writeJson(getDaemonMetaPath(agent_id), meta, { spaces: 2 });
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
        const agent_id = String(data?.agent_id || "").trim();
        const workspace_path = String(data?.workspace_path || "").trim();
        const instance_id = String(data?.instance_id || "").trim();
        finish(frame.success === true && Number.isInteger(pid) && pid > 0 && agent_id && workspace_path && instance_id
          ? { pid, agent_id, workspace_path, instance_id }
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
  meta: Pick<DaemonMeta, "pid" | "agent_id" | "workspace_path" | "instance_id">,
  identity: DaemonRuntimeIdentity,
): boolean {
  return identity.pid === meta.pid
    && identity.agent_id === meta.agent_id
    && path.resolve(identity.workspace_path) === path.resolve(meta.workspace_path)
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

/** RPC 失联时，严格确认 OS 命令行属于 meta 描述的当前 Agent daemon。 */
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
    && command.includes(meta.agent_id);
}

/**
 * 等待 daemon RPC 进入可连接状态。
 */
async function waitForDaemonReady(params: {
  pid: number;
  agent_id: string;
  workspace_path: string;
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
      agent_id: params.agent_id,
      workspace_path: params.workspace_path,
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
  agent_id: string;
  workspace_path: string;
  pid: number;
  instance_id: string;
}): Promise<void> {
  const read_owned_meta = async (): Promise<DaemonMeta | null> => {
    const meta = await readDaemonMeta(params.agent_id);
    return meta
      && meta.pid === params.pid
      && meta.instance_id === params.instance_id
      && meta.agent_id === params.agent_id
      && path.resolve(meta.workspace_path) === path.resolve(params.workspace_path)
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
  await fs.remove(getDaemonPidPath(params.agent_id));
  await fs.remove(getDaemonMetaPath(params.agent_id));
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
  agent_id: string;
  workspace_path: string;
  cliPath: string;
  args: string[];
}): Promise<{ pid: number; log_path: string }> => {
  const { agent_id, workspace_path, cliPath, args } = params;
  const instance_id = randomUUID();

  await fs.ensureDir(get_agent_runtime_dir_path(agent_id));
  await cleanupStaleDaemonFiles(agent_id);

  const existingPid = await readDaemonPid(agent_id);
  if (existingPid && isProcessAlive(existingPid)) {
    const existing_meta = await readDaemonMeta(agent_id);
    const existing_rpc_port = existing_meta
      ? parsePortLike(pickArgValue(existing_meta.args, "--rpc-port"))
      : undefined;
    const existing_identity = existing_rpc_port
      ? await read_daemon_runtime_identity({ host: "127.0.0.1", port: existing_rpc_port })
      : null;
    const confirmed_existing = Boolean(
      existing_meta
      && existing_meta.pid === existingPid
      && existing_meta.agent_id === agent_id
      && path.resolve(existing_meta.workspace_path) === path.resolve(workspace_path)
      && (existing_identity
        ? daemon_identity_matches(existing_meta, existing_identity)
        : await command_matches_daemon_meta(existing_meta)),
    );
    if (confirmed_existing) {
      throw new Error(`Daemon already running (pid: ${existingPid})`);
    }
    await fs.remove(getDaemonPidPath(agent_id));
    await fs.remove(getDaemonMetaPath(agent_id));
  }

  const log_path = getDaemonLogPath(agent_id);
  const log_fd = fs.openSync(log_path, "a");

  const childEnv: NodeJS.ProcessEnv = {
    ...mergeProcessEnvWithPlatformGlobalEnv(process.env),
    DOWNCITY_DAEMON: "1",
    DOWNCITY_DAEMON_INSTANCE_ID: instance_id,
  };

  // 关键注释：daemon 进程必须 detached + unref 才能在父进程退出后继续运行。
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: workspace_path,
    detached: true,
    stdio: ["ignore", log_fd, log_fd],
    env: childEnv,
  });

  child.unref();

  if (!child.pid) {
    fs.closeSync(log_fd);
    throw new Error("Failed to start daemon process (missing pid)");
  }

  await writeDaemonFiles(agent_id, {
    pid: child.pid,
    instance_id,
    agent_id,
    workspace_path,
    started_at: new Date().toISOString(),
    command: process.execPath,
    args: [cliPath, ...args],
    node: process.version,
    platform: process.platform,
  });

  // 关键点（中文）：只有 RPC 端口可连接后，才把 daemon 视为真正启动成功。
  try {
    await waitForDaemonReady({
      pid: child.pid,
      agent_id,
      workspace_path,
      instance_id,
      args,
    });

  } catch (error) {
    // 回滚：无法 ready 或无法登记时立即停止 daemon 并清理状态文件。
    await rollback_daemon_startup({
      agent_id,
      workspace_path,
      pid: child.pid,
      instance_id,
    });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}. Check daemon log: ${log_path}`);
  }

  return { pid: child.pid, log_path };
};

/**
 * 停止 daemon 子进程。
 *
 * 策略（中文）
 * - 先发 `SIGTERM` 做优雅退出；超时后回退 `SIGKILL`。
 * - 无论 stop 结果如何，最终清理 pid/meta，避免状态残留。
 */
export const stopDaemonProcess = async (params: {
  agent_id: string;
  workspace_path: string;
  timeoutMs?: number;
}): Promise<{ stopped: boolean; pid?: number }> => {
  const { agent_id, workspace_path, timeoutMs = 10_000 } = params;

  await cleanupStaleDaemonFiles(agent_id);
  const pid = await readDaemonPid(agent_id);
  if (!pid) return { stopped: false };

  if (!isProcessAlive(pid)) {
    await fs.remove(getDaemonPidPath(agent_id));
    await fs.remove(getDaemonMetaPath(agent_id));
    return { stopped: false, pid };
  }

  const meta = await readDaemonMeta(agent_id);
  if (
    !meta
    || meta.pid !== pid
    || meta.agent_id !== agent_id
    || path.resolve(meta.workspace_path) !== path.resolve(workspace_path)
  ) {
    await fs.remove(getDaemonPidPath(agent_id));
    await fs.remove(getDaemonMetaPath(agent_id));
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
    await fs.remove(getDaemonPidPath(agent_id));
    await fs.remove(getDaemonMetaPath(agent_id));
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

  await fs.remove(getDaemonPidPath(agent_id));
  await fs.remove(getDaemonMetaPath(agent_id));

  return { stopped: true, pid };
};
