/**
 * 受管 Agent daemon internal RPC 客户端。
 *
 * 关键点（中文）
 * - 修改运行时前先校验 daemon 返回身份，避免 stale 端口误操作其他进程。
 * - 这里只承载 City 本机控制命令，不进入 RemoteAgent SDK 公共客户端。
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { isProcessAlive, readDaemonMeta } from "@/city/process/daemon/Manager.js";

const RPC_TIMEOUT_MS = 2_000;

/**
 * 请求运行中的 Agent 从宿主事实源重新加载 Workspace Env。
 *
 * @returns `false` 表示 Agent 当前未运行；`true` 表示在线同步完成。
 */
export async function reload_running_agent_env(agent_id: string): Promise<boolean> {
  const meta = await readDaemonMeta(agent_id);
  if (!meta || !isProcessAlive(meta.pid)) return false;
  const rpc_port = parse_rpc_port(meta.args);
  if (!rpc_port) throw new Error(`Agent ${agent_id} daemon RPC port is unavailable`);

  await new Promise<void>((resolve, reject) => {
    const identity_request_id = `env-identity-${randomUUID()}`;
    const reload_request_id = `env-reload-${randomUUID()}`;
    const socket = createConnection({ host: "127.0.0.1", port: rpc_port });
    let buffered = "";
    let settled = false;

    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(RPC_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id: identity_request_id, method: "internal.status.get" })}\n`);
    });
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      let newline_index = buffered.indexOf("\n");
      while (newline_index >= 0) {
        const line = buffered.slice(0, newline_index).trim();
        buffered = buffered.slice(newline_index + 1);
        newline_index = buffered.indexOf("\n");
        if (!line) continue;
        try {
          const frame = JSON.parse(line) as {
            id?: unknown;
            success?: unknown;
            error?: unknown;
            data?: Record<string, unknown>;
          };
          if (frame.id === identity_request_id) {
            if (frame.success !== true || !identity_matches(meta, frame.data)) {
              finish(new Error(`Agent ${agent_id} daemon RPC identity mismatch`));
              return;
            }
            socket.write(`${JSON.stringify({ id: reload_request_id, method: "internal.workspace.reload_env" })}\n`);
            continue;
          }
          if (frame.id !== reload_request_id) continue;
          if (frame.success !== true) {
            finish(new Error(String(frame.error || "Workspace Env reload failed")));
            return;
          }
          finish();
          return;
        } catch (error) {
          finish(error);
          return;
        }
      }
    });
    socket.once("timeout", () => finish(new Error(`Agent ${agent_id} Env reload RPC timed out`)));
    socket.once("error", finish);
    socket.once("close", () => {
      if (!settled) finish(new Error(`Agent ${agent_id} Env reload RPC closed unexpectedly`));
    });
  });
  return true;
}

/** 从 daemon 启动参数解析 RPC 端口。 */
function parse_rpc_port(args: string[]): number | undefined {
  const index = args.findIndex((item) => String(item).trim() === "--rpc-port");
  const raw = index >= 0 ? Number.parseInt(String(args[index + 1] || ""), 10) : Number.NaN;
  return Number.isInteger(raw) && raw > 0 && raw <= 65_535 ? raw : undefined;
}

/** 校验 RPC 身份与本地 daemon meta 完全一致。 */
function identity_matches(
  meta: { pid: number; agent_id: string; workspace_path: string; instance_id: string },
  data?: Record<string, unknown>,
): boolean {
  return Number(data?.pid) === meta.pid
    && String(data?.agent_id || "") === meta.agent_id
    && path.resolve(String(data?.workspace_path || "")) === path.resolve(meta.workspace_path)
    && String(data?.instance_id || "") === meta.instance_id;
}
