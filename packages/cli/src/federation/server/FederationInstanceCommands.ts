/**
 * Federation 单次实例命令。
 *
 * 目标只由参数或本次列表选择确定；状态查询独立展示登记、实时探测和发布历史。
 * 发布结果不代表服务存活，历史失败不作为当前 restart 阻断依据。
 * 停止、重启与日志仅支持 CLI 管理的本地实例，远程记录不推断进程控制能力。
 */
import { open } from "node:fs/promises";
import type { ServerProfile } from "@/federation/core/session.js";
import { inspect_release_process } from "@/federation/deploy/release/LocalReleaseProcess.js";
import { read_local_deployment_record, type LocalDeploymentRecord } from "@/federation/deploy/release/LocalDeploymentRecord.js";
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

/** 分别显示登记、系统托管器、实时身份和 HTTP 探测；状态检查不写配置或修复进程。 */
async function show_instance_status(server: ServerProfile): Promise<void> {
  let manager = "not applicable";
  let manager_state = "not applicable";
  let manager_detail: string | undefined;
  let failure_code: string | undefined;
  let runtime_pid: number | undefined;
  let instance_id: string | undefined;
  if (server.target === "local" && server.fed_id) {
    manager = "unknown";
    try {
      const process_state = await inspect_release_process(server);
      manager = process_state.manager;
      manager_state = process_state.state;
      failure_code = process_state.failure_code;
      runtime_pid = process_state.identity?.pid;
      instance_id = process_state.identity?.instance_id;
    } catch (error) {
      manager_state = "unknown";
      manager_detail = error instanceof Error ? error.message : "Service inspection unavailable";
    }
  }
  let health = "unreachable";
  try {
    const response = await fetch(`${server.base_url.replace(/\/+$/u, "")}/health`, {
      signal: AbortSignal.timeout(3_000),
      redirect: "manual",
    });
    health = `HTTP ${response.status}`;
    if (response.ok && instance_id) {
      const payload = await response.json() as Record<string, unknown>;
      health += payload.ok === true && payload.fed_id === server.fed_id && payload.release_id === server.release_id
        && payload.instance_id === instance_id ? " · identity matched, ready" : " · identity mismatch or not ready";
    } else {
      if (server.target === "local") health += " · identity not verified";
      await response.body?.cancel();
    }
  } catch {
    // 保留不可达事实，不据此覆盖 registry 或尝试重启服务。
  }
  emitCliBlock({
    title: "Registered instance",
    facts: [
      { label: "registered status", value: server.status ?? "unknown" },
      { label: "target", value: server.target ?? "remote connection" },
      { label: "registered release", value: server.release_id ?? "no independent release" },
      { label: "registered artifact", value: server.release_dir ?? "not installed" },
      { label: "saved auto start policy", value: String(server.config_snapshot?.deployment.process?.auto_start ?? false) },
      { label: "saved restart on failure", value: String(server.config_snapshot?.deployment.process?.restart_on_failure ?? true) },
    ],
    note: "Registry values and saved policy do not establish which release is running.",
  });
  emitCliBlock({
    title: "Live instance status",
    facts: [
      { label: "service manager", value: manager },
      { label: "manager state", value: manager_state },
      { label: "runner failure", value: failure_code ?? "none recorded" },
      { label: "runtime pid", value: runtime_pid ? String(runtime_pid) : "not verified" },
      { label: "instance", value: instance_id ?? "not verified" },
      { label: "health endpoint", value: health },
    ],
    note: manager_detail
      ? `${manager_detail}; live service state is unknown. Inspect the system service and health endpoint manually.`
      : "Service manager and health observations are independent of registry and deployment history.",
  });
  if (server.target === "local" && server.fed_id) await show_local_deployment_status(server.fed_id);
}

/** 只读本地发布历史；记录缺失或损坏均不影响实时探测，不用历史失败推断当前阻断。 */
async function show_local_deployment_status(fed_id: string): Promise<void> {
  let record: LocalDeploymentRecord | undefined;
  try {
    record = await read_local_deployment_record(fed_id);
  } catch (error) {
    emitCliBlock({
      tone: "warning",
      title: "Local deployment history",
      facts: [{ label: "history", value: "unknown" }],
      note: error instanceof Error ? error.message : "Unable to read deployment.json; inspect it manually.",
    });
    return;
  }
  if (!record) {
    emitCliBlock({ title: "Local deployment history", facts: [{ label: "history", value: "not recorded" }] });
    return;
  }
  const { latest, last_success, last_failure } = record;
  emitCliBlock({
    title: "Local deployment history",
    facts: [
      { label: "last successful release", value: last_success?.release_id ?? "not recorded" },
      { label: "last failed release", value: last_failure ? last_failure.release_id ?? "not produced" : "none recorded" },
      { label: "last failure phase", value: last_failure?.phase ?? "none recorded" },
      { label: "last failure cleanup", value: last_failure?.cleanup ?? "none recorded" },
      { label: "latest release", value: latest.release_id ?? "not produced" },
      { label: "latest outcome", value: latest.outcome },
      { label: "latest phase", value: latest.phase },
      { label: "latest cutover started", value: String(latest.cutover_started) },
      { label: "latest candidate started", value: String(latest.candidate_started) },
      { label: "latest cleanup", value: latest.cleanup },
      { label: "recovery required", value: String(record.recovery_required) },
      { label: "restart recovery", value: record.recovery_required ? "blocked until an explicit fed deploy succeeds" : "not blocked by deployment history" },
    ],
    note: latest.cleanup === "unknown"
      ? "Candidate cleanup is unknown. Inspect the system service, automatic startup association and health endpoint manually; do not assume it stopped."
      : "Deployment history does not establish live service state; the last successful release is not proof that it is running.",
  });
}

/** 需要完整的受管本地记录，避免把普通连接当作可控制进程。 */
function require_local_instance(server: ServerProfile): void {
  if (server.target !== "local" || !server.release_id || !server.release_dir || !server.fed_id) {
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
