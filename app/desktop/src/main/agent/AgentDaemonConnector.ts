/**
 * Desktop Agent daemon 连接解析器。
 *
 * 职责说明（中文）
 * - 从共享运行目录读取 daemon 元数据并解析本机 RPC 地址。
 * - 通过 `internal.status.get` 校验真实进程身份，拒绝 stale 文件或端口复用。
 * - 只负责发现健康 daemon，不负责启动进程或创建 RemoteAgent。
 */

import fs from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { get_agent_registry_root_path } from "@downcity/agent-registry";
import type {
  AgentDaemonIdentity,
  AgentDaemonMeta,
  ResolveAgentDaemonInput,
} from "@/types/AgentDaemon.js";

const DAEMON_RPC_HOST = "127.0.0.1";
const DAEMON_IDENTITY_TIMEOUT_MS = 1_000;

/**
 * 解析并验证一个已经运行的 Agent daemon RPC 地址。
 *
 * 返回 `null` 表示没有可安全连接的运行实例，调用方可以进入启动流程。
 */
export async function resolve_running_agent_rpc_url(
  input: ResolveAgentDaemonInput,
): Promise<string | null> {
  const agent_id = String(input.agent_id || "").trim();
  const workspace_path = String(input.workspace_path || "").trim();
  if (!agent_id || !workspace_path) return null;

  try {
    const meta = await read_daemon_meta(agent_id);
    if (!meta || !daemon_meta_matches(meta, input)) return null;
    const rpc_port = parse_rpc_port(meta.args);
    if (!rpc_port) return null;
    const identity = await read_daemon_identity(rpc_port);
    if (!identity || !daemon_identity_matches(meta, identity)) return null;
    return `rpc://${DAEMON_RPC_HOST}:${rpc_port}`;
  } catch {
    return null;
  }
}

/** 读取并校验 daemon 元数据的最小结构。 */
async function read_daemon_meta(agent_id: string): Promise<AgentDaemonMeta | null> {
  const meta_path = path.join(
    get_agent_registry_root_path(),
    "runtimes",
    agent_id,
    "daemon.json",
  );
  const value = JSON.parse(await fs.readFile(meta_path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pid = Number(record.pid);
  const instance_id = String(record.instance_id || "").trim();
  const stored_agent_id = String(record.agent_id || "").trim();
  const workspace_path = String(record.workspace_path || "").trim();
  const args = Array.isArray(record.args) ? record.args.map(String) : [];
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (!instance_id || !stored_agent_id || !workspace_path || args.length === 0) return null;
  return {
    pid,
    instance_id,
    agent_id: stored_agent_id,
    workspace_path,
    args,
  };
}

/** 从 daemon 启动参数解析本机 RPC 端口。 */
function parse_rpc_port(args: string[]): number | null {
  const inline_prefix = "--rpc-port=";
  const inline_value = args.find((item) => item.startsWith(inline_prefix));
  const index = args.findIndex((item) => item === "--rpc-port");
  const raw_value = inline_value
    ? inline_value.slice(inline_prefix.length)
    : index >= 0
      ? args[index + 1]
      : undefined;
  const rpc_port = Number(raw_value);
  return Number.isInteger(rpc_port) && rpc_port > 0 && rpc_port <= 65_535
    ? rpc_port
    : null;
}

/** 读取 RPC 服务声明的真实 daemon 身份。 */
async function read_daemon_identity(
  rpc_port: number,
): Promise<AgentDaemonIdentity | null> {
  return await new Promise<AgentDaemonIdentity | null>((resolve) => {
    const request_id = `desktop-daemon-identity-${randomUUID()}`;
    const socket = createConnection({ host: DAEMON_RPC_HOST, port: rpc_port });
    let buffered = "";
    let settled = false;

    const finish = (identity: AgentDaemonIdentity | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(identity);
    };

    socket.setTimeout(DAEMON_IDENTITY_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id: request_id, method: "internal.status.get" })}\n`);
    });
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const newline_index = buffered.indexOf("\n");
      if (newline_index < 0) return;
      try {
        const frame = JSON.parse(buffered.slice(0, newline_index)) as Record<string, unknown>;
        if (frame.id !== request_id || frame.success !== true) {
          finish(null);
          return;
        }
        finish(to_daemon_identity(frame.data));
      } catch {
        finish(null);
      }
    });
    socket.once("error", () => finish(null));
    socket.once("timeout", () => finish(null));
    socket.once("close", () => finish(null));
  });
}

/** 把未知 RPC payload 收敛为 daemon 身份。 */
function to_daemon_identity(value: unknown): AgentDaemonIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pid = Number(record.pid);
  const agent_id = String(record.agent_id || "").trim();
  const workspace_path = String(record.workspace_path || "").trim();
  const instance_id = String(record.instance_id || "").trim();
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (!agent_id || !workspace_path || !instance_id) return null;
  return { pid, agent_id, workspace_path, instance_id };
}

/** 校验本地元数据是否属于当前 Registry 目标。 */
function daemon_meta_matches(
  meta: AgentDaemonMeta,
  input: ResolveAgentDaemonInput,
): boolean {
  return meta.agent_id === input.agent_id
    && path.resolve(meta.workspace_path) === path.resolve(input.workspace_path);
}

/** 校验 RPC 身份与本地 daemon 元数据是否完全一致。 */
function daemon_identity_matches(
  meta: AgentDaemonMeta,
  identity: AgentDaemonIdentity,
): boolean {
  return identity.pid === meta.pid
    && identity.agent_id === meta.agent_id
    && path.resolve(identity.workspace_path) === path.resolve(meta.workspace_path)
    && identity.instance_id === meta.instance_id;
}
