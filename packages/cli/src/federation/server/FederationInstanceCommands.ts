/**
 * Federation 单次实例命令。
 *
 * 目标只由参数或本次列表选择确定；状态查询区分登记状态和实时 HTTP 探测。
 * 停止、重启与日志仅支持 CLI 管理的本地实例，远程记录不推断进程控制能力。
 */
import { open } from "node:fs/promises";
import type { ServerProfile } from "@/federation/core/session.js";
import {
  restart_managed_local_server,
  stop_managed_local_server,
} from "@/federation/deploy/runtime/LocalFederationDeployer.js";
import { resolve_federation_target, type FederationTargetOptions } from "@/federation/server/FederationTarget.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";

/** 统一定位、展示并执行本次实例操作；取消列表选择不产生副作用。 */
export async function run_federation_instance_command(
  action: "status" | "logs" | "stop" | "restart",
  options: FederationTargetOptions,
): Promise<void> {
  const server = await resolve_federation_target(options);
  if (!server) return;
  emitCliBlock({
    title: "Federation",
    facts: [
      { label: "name", value: server.name },
      { label: "id", value: server.fed_id ?? "not registered" },
      { label: "url", value: server.base_url },
    ],
  });
  if (action === "status") {
    await show_instance_status(server);
    return;
  }
  require_local_instance(server);
  if (action === "logs") {
    await show_recent_logs(server);
    return;
  }
  if (action === "stop") {
    const stopped = await stop_managed_local_server(server);
    if (!stopped) throw new CliError({ title: "Unable to stop the managed local instance" });
  } else {
    await restart_managed_local_server(server);
  }
  emitCliBlock({
    tone: "success",
    title: action === "stop" ? "Local Federation stopped" : "Local Federation restarted",
    facts: [{ label: "url", value: server.base_url }],
  });
}

/** 显示登记状态和限时 HTTP 探测结果，健康响应不作为实例身份验证。 */
async function show_instance_status(server: ServerProfile): Promise<void> {
  let health = "unreachable";
  try {
    const response = await fetch(`${server.base_url.replace(/\/+$/u, "")}/health`, {
      signal: AbortSignal.timeout(3_000),
      redirect: "manual",
    });
    health = `HTTP ${response.status}`;
    await response.body?.cancel();
  } catch {
    // 保留不可达事实，不据此覆盖 registry 或尝试重启服务。
  }
  emitCliBlock({
    title: "Instance status",
    facts: [
      { label: "registered status", value: server.status ?? "unknown" },
      { label: "target", value: server.target ?? "remote connection" },
      { label: "pid", value: server.pid ? String(server.pid) : "not registered" },
      { label: "release", value: server.release_id ?? "no independent release" },
      { label: "artifact", value: server.release_dir ?? "not installed" },
      { label: "health endpoint", value: health },
    ],
    note: "Registry metadata and HTTP reachability are shown separately; instance identity is not verified.",
  });
}

/** 需要完整的受管本地记录，避免把普通连接当作可控制进程。 */
function require_local_instance(server: ServerProfile): void {
  if (server.target !== "local" || !server.pid || !server.instance_id || !server.fed_id) {
    throw new CliError({
      title: "This operation requires a managed local Federation instance",
      note: `${server.name} (${server.base_url})`,
    });
  }
}

/** 只读日志末尾至多 64 KiB / 200 行，避免将整个长期日志载入内存。 */
async function show_recent_logs(server: ServerProfile): Promise<void> {
  if (!server.log_path) throw new CliError({ title: "No log path is registered for this instance" });
  let file;
  try {
    file = await open(server.log_path, "r");
    const stat = await file.stat();
    const offset = Math.max(0, stat.size - 65_536);
    const buffer = Buffer.alloc(Math.min(stat.size, 65_536));
    const { bytesRead: bytes_read } = await file.read(buffer, 0, buffer.length, offset);
    const text = buffer.subarray(0, bytes_read).toString("utf8");
    const complete_lines = offset > 0 ? text.slice(text.indexOf("\n") + 1) : text;
    const lines = complete_lines.trimEnd().split("\n").slice(-200);
    process.stdout.write(`${lines.join("\n")}\n`);
  } catch {
    throw new CliError({ title: "Unable to read Federation logs", note: server.log_path });
  } finally {
    await file?.close();
  }
}
