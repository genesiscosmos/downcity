/**
 * CLI City daemon 的 Agent Env 刷新客户端。
 *
 * 唯一 City RPC 端口承载全部 Agent，请求通过 `agent_id` 路由；发送前核对 City
 * daemon PID 与 instance_id，避免把内部命令发给其他进程。
 */

import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import {
  is_process_alive,
  read_daemon_meta,
} from "@/city/process/daemon/Manager.js";

const RPC_TIMEOUT_MS = 2_000;

/** 请求运行中 City 重新加载指定 Agent 的 Workspace Env。 */
export async function reload_running_agent_env(agent_id: string): Promise<boolean> {
  const meta = await read_daemon_meta();
  if (!meta || !is_process_alive(meta.pid) || !meta.agent_ids.includes(agent_id)) return false;
  await new Promise<void>((resolve, reject) => {
    const identity_request_id = `city-identity-${randomUUID()}`;
    const reload_request_id = `env-reload-${randomUUID()}`;
    const socket = createConnection({ host: meta.rpc_host, port: meta.rpc_port });
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
    socket.once("connect", () => socket.write(`${JSON.stringify({
      id: identity_request_id,
      method: "internal.city.status",
    })}\n`));
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
            if (
              frame.success !== true
              || Number(frame.data?.pid) !== meta.pid
              || String(frame.data?.instance_id || "") !== meta.instance_id
            ) {
              finish(new Error("City daemon RPC identity mismatch"));
              return;
            }
            socket.write(`${JSON.stringify({
              id: reload_request_id,
              agent_id,
              method: "internal.workspace.reload_env",
            })}\n`);
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
    socket.once("timeout", () => finish(new Error(`Agent ${agent_id} Env reload timed out`)));
    socket.once("error", finish);
    socket.once("close", () => {
      if (!settled) finish(new Error(`Agent ${agent_id} Env reload RPC closed unexpectedly`));
    });
  });
  return true;
}
