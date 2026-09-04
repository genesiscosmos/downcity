/**
 * City 宿主进程协调协议。
 *
 * 该模块只协调 CLI 与 Desktop 的 City 宿主，不保存 Agent 配置，也不改变
 * Agent 的生命周期模型。宿主启动前读取状态，确认后可以请求已有宿主退出。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";

/** City 宿主类型。 */
export type CityHostOwner = "cli" | "desktop";

/** City 宿主状态文件内容。 */
export interface CityHostState {
  /** 当前宿主类型。 */
  owner: CityHostOwner;
  /** 操作系统进程 ID。 */
  pid: number;
  /** 本次宿主实例的唯一 ID。 */
  instance_id: string;
  /** 宿主启动时间。 */
  started_at: string;
  /** 可选 HTTP 地址。 */
  http_host?: string;
  /** 可选 HTTP 端口。 */
  http_port?: number;
  /** 可选 RPC 地址。 */
  rpc_host?: string;
  /** 可选 RPC 端口。 */
  rpc_port?: number;
}

/** 当前宿主状态文件路径。 */
export function get_city_host_state_path(): string {
  const root_path = String(process.env.DC_PLATFORM_ROOT || "").trim()
    || path.join(os.homedir(), ".downcity");
  return path.join(path.resolve(root_path), "runtimes", "city", "host.json");
}

/** 生成本次宿主实例 ID。 */
export function create_city_host_instance_id(): string {
  return randomUUID();
}

/** 读取当前 City 宿主状态。无效或已退出的状态返回 null。 */
export async function read_city_host_state(): Promise<CityHostState | null> {
  const file_path = get_city_host_state_path();
  let file_identity: { dev: number; ino: number } | undefined;
  try {
    const file_handle = await fs.open(file_path, "r");
    let content: string;
    try {
      const [raw, stat] = await Promise.all([
        file_handle.readFile("utf8"),
        file_handle.stat(),
      ]);
      content = raw;
      file_identity = { dev: stat.dev, ino: stat.ino };
    } finally {
      await file_handle.close();
    }
    const value = JSON.parse(content) as Partial<CityHostState>;
    if (value.owner !== "cli" && value.owner !== "desktop") {
      await remove_city_host_state_if_same(file_path, file_identity);
      return null;
    }
    if (!Number.isInteger(value.pid) || Number(value.pid) <= 0) {
      await remove_city_host_state_if_same(file_path, file_identity);
      return null;
    }
    if (!String(value.instance_id || "").trim() || !String(value.started_at || "").trim()) {
      await remove_city_host_state_if_same(file_path, file_identity);
      return null;
    }
    if (!is_process_alive(Number(value.pid))) {
      await remove_city_host_state_if_same(file_path, file_identity);
      return null;
    }
    return {
      owner: value.owner,
      pid: Number(value.pid),
      instance_id: String(value.instance_id),
      started_at: String(value.started_at),
      ...(typeof value.http_host === "string" ? { http_host: value.http_host } : {}),
      ...(valid_port(value.http_port) ? { http_port: Number(value.http_port) } : {}),
      ...(typeof value.rpc_host === "string" ? { rpc_host: value.rpc_host } : {}),
      ...(valid_port(value.rpc_port) ? { rpc_port: Number(value.rpc_port) } : {}),
    };
  } catch {
    if (file_identity) await remove_city_host_state_if_same(file_path, file_identity);
    return null;
  }
}

/** 登记当前 City 宿主。 */
export async function register_city_host(state: CityHostState): Promise<void> {
  const file_path = get_city_host_state_path();
  await fs.mkdir(path.dirname(file_path), { recursive: true });
  if (await claim_city_host_state(file_path, state)) return;

  const current = await read_city_host_state();
  if (current) {
    throw new Error(
      `City is already owned by ${current.owner} (pid: ${current.pid})`,
    );
  }
  if (!await claim_city_host_state(file_path, state)) {
    const owner = await read_city_host_state();
    throw new Error(owner
      ? `City is already owned by ${owner.owner} (pid: ${owner.pid})`
      : "City host ownership could not be acquired");
  }
}

/** 只删除仍属于当前实例的宿主状态。 */
export async function unregister_city_host(instance_id: string): Promise<void> {
  const file_path = get_city_host_state_path();
  try {
    const file_handle = await fs.open(file_path, "r");
    let current: Partial<CityHostState>;
    let file_identity: { dev: number; ino: number };
    try {
      const [content, stat] = await Promise.all([
        file_handle.readFile("utf8"),
        file_handle.stat(),
      ]);
      current = JSON.parse(content) as Partial<CityHostState>;
      file_identity = { dev: stat.dev, ino: stat.ino };
    } finally {
      await file_handle.close();
    }
    if (String(current.instance_id || "") !== String(instance_id || "")) return;
    await remove_city_host_state_if_same(file_path, file_identity);
  } catch {
    return;
  }
}

/** 请求已有宿主退出并等待进程释放资源。 */
export async function request_city_host_shutdown(
  state: CityHostState,
  timeout_ms = 10_000,
): Promise<void> {
  if (state.rpc_host && state.rpc_port) {
    const accepted = await request_rpc_shutdown(state);
    if (!accepted && is_process_alive(state.pid)) process.kill(state.pid, "SIGTERM");
  } else if (is_process_alive(state.pid)) {
    process.kill(state.pid, "SIGTERM");
  }
  await wait_for_city_host_exit(state, timeout_ms);
}

/** 等待指定宿主进程退出；超时不会强制杀死进程。 */
export async function wait_for_city_host_exit(
  state: CityHostState,
  timeout_ms = 10_000,
): Promise<void> {
  const started_at = Date.now();
  while (is_process_alive(state.pid)) {
    if (Date.now() - started_at >= timeout_ms) {
      throw new Error(
        `Timed out waiting for ${state.owner} City to stop (pid: ${state.pid})`,
      );
    }
    await sleep(100);
  }
  await unregister_city_host(state.instance_id);
}

/** 检查进程是否存活。 */
export function is_process_alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function request_rpc_shutdown(state: CityHostState): Promise<boolean> {
  const rpc_host = state.rpc_host;
  const rpc_port = state.rpc_port;
  if (!rpc_host || !rpc_port) return false;
  return await new Promise((resolve) => {
    const socket = createConnection({ host: rpc_host, port: rpc_port });
    let buffered = "";
    let settled = false;
    const finish = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(1_500);
    socket.once("connect", () => socket.write(`${JSON.stringify({
      id: `city-shutdown-${randomUUID()}`,
      method: "internal.city.shutdown",
    })}\n`));
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const newline_index = buffered.indexOf("\n");
      if (newline_index < 0) return;
      try {
        const frame = JSON.parse(buffered.slice(0, newline_index)) as { success?: unknown };
        finish(frame.success === true);
      } catch {
        finish(false);
      }
    });
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}

function valid_port(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65_535;
}

function has_error_code(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function claim_city_host_state(
  file_path: string,
  state: CityHostState,
): Promise<boolean> {
  const temporary_path = `${file_path}.${state.instance_id}.tmp`;
  await fs.writeFile(temporary_path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  try {
    await fs.link(temporary_path, file_path);
    return true;
  } catch (error) {
    if (has_error_code(error, "EEXIST")) return false;
    throw error;
  } finally {
    await fs.rm(temporary_path, { force: true });
  }
}

async function remove_city_host_state_if_same(
  file_path: string,
  file_identity: { dev: number; ino: number },
): Promise<void> {
  try {
    const current = await fs.stat(file_path);
    if (current.dev !== file_identity.dev || current.ino !== file_identity.ino) return;
    await fs.rm(file_path, { force: true });
  } catch {
    return;
  }
}

async function sleep(timeout_ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeout_ms));
}
