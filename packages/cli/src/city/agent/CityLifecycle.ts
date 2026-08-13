/**
 * CLI City 生命周期命令。
 *
 * `on/off/restart/status` 只管理唯一 City daemon。Agent 配置、Workspace 与 Session
 * 数据保持独立，不会被生命周期命令创建、删除或改绑。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build_city_run_args } from "@/city/process/daemon/CliArgs.js";
import {
  cleanup_stale_daemon_files,
  diagnose_daemon_stale_reasons,
  get_daemon_log_path,
  is_process_alive,
  read_daemon_meta,
  read_daemon_pid,
  start_daemon_process,
  stop_daemon_process,
} from "@/city/process/daemon/Manager.js";
import type { CityDaemonOptions } from "@/city/process/daemon/Types.js";
import { list_agent_configs } from "@/city/process/registry/AgentConfigRepository.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import { run_city_foreground } from "@/city/agent/Run.js";
import { read_city_host_state, request_city_host_shutdown } from "@downcity/city";
import prompts from "@/city/tui/Prompts.js";

/** 启动 City；foreground=true 时由当前进程直接持有。 */
export async function city_on(options: CityDaemonOptions): Promise<void> {
  const existing_host = await read_city_host_state();
  if (existing_host) {
    const answer = await prompts({
      type: "confirm",
      name: "replace",
      message: `City is already running in ${existing_host.owner} (pid ${existing_host.pid}). Close it and continue?`,
      initial: false,
    });
    if (answer.replace !== true) {
      throw new CliError({ title: "City start cancelled", note: "The existing City was left running." });
    }
    await request_city_host_shutdown(existing_host);
  }
  if (options.foreground) {
    await run_city_foreground(options);
    return;
  }
  const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
  const http_port = options.http_port ?? 5314;
  const rpc_port = options.rpc_port ?? 15314;
  const agent_ids = list_agent_configs().map((agent) => agent.agent_id);
  const args = build_city_run_args({ host, http_port, rpc_port });
  const current_file = fileURLToPath(import.meta.url);
  const cli_path = path.resolve(path.dirname(current_file), "../../index.js");
  try {
    const result = await start_daemon_process({
      cli_path,
      args,
      host,
      http_port,
      rpc_port,
      agent_ids,
    });
    emitCliBlock({
      tone: "success",
      title: "City started",
      facts: [
        { label: "PID", value: String(result.pid) },
        { label: "Agents", value: String(agent_ids.length) },
        { label: "HTTP", value: `http://${host}:${http_port}` },
        { label: "RPC", value: `rpc://127.0.0.1:${rpc_port}/<agent_id>` },
      ],
    });
  } catch (error) {
    throw new CliError({
      title: "Failed to start City",
      note: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 幂等停止 City daemon。 */
export async function city_off(): Promise<void> {
  try {
    const result = await stop_daemon_process();
    emitCliBlock({
      tone: result.stopped ? "success" : "info",
      title: result.stopped ? "City stopped" : "City is not running",
      ...(result.pid ? { facts: [{ label: "PID", value: String(result.pid) }] } : {}),
    });
  } catch (error) {
    throw new CliError({
      title: "Failed to stop City",
      note: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 重启 City daemon，并重新恢复最新 Agent/Plugin 配置。 */
export async function city_restart(options: CityDaemonOptions): Promise<void> {
  await stop_daemon_process();
  await city_on(options);
}

/** 输出唯一 City daemon 状态。 */
export async function city_status(options?: { fix?: boolean }): Promise<void> {
  const pid = await read_daemon_pid();
  const meta = await read_daemon_meta();
  if (pid && is_process_alive(pid) && meta?.pid === pid) {
    emitCliBlock({
      tone: "success",
      title: "City status",
      summary: "running",
      facts: [
        { label: "PID", value: String(pid) },
        { label: "Started at", value: meta.started_at },
        { label: "Agents", value: meta.agent_ids.join(", ") || "0" },
        { label: "HTTP", value: `http://${meta.host}:${meta.http_port}` },
        { label: "RPC", value: `rpc://${meta.rpc_host}:${meta.rpc_port}/<agent_id>` },
        { label: "Log", value: get_daemon_log_path() },
      ],
    });
    return;
  }
  if (pid || meta) {
    const reasons = await diagnose_daemon_stale_reasons();
    if (options?.fix) await cleanup_stale_daemon_files();
    emitCliBlock({
      tone: "warning",
      title: "City status",
      summary: options?.fix ? "stale state cleaned" : "stale",
      facts: [{
        label: "Reason",
        value: reasons.map((reason) => reason.message).join("; ") || "identity unavailable",
      }],
      ...(!options?.fix ? { note: "Run `city status --fix` to clean stale state." } : {}),
    });
    return;
  }
  emitCliBlock({ tone: "info", title: "City status", summary: "stopped" });
}
