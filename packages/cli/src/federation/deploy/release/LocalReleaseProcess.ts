/**
 * 已安装 Node release 的进程控制与身份就绪检查。
 *
 * launchd/systemd 托管专用运行器；运行器读取独立产物与私有配置，不使用源码启动脚本。
 * 每次自动恢复通过 receipt 与系统主 PID 联合核对，登记时的旧 PID 不作为控制依据。
 */
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { start_system_service, stop_system_service, inspect_system_service, resolve_system_service, type SystemServiceSpec } from "../process/SystemServiceAdapter.js";
import { service_runtime_paths, read_service_config, read_service_receipt, write_service_json, type ServiceRuntimeConfig } from "../process/ServiceRuntime.js";
import type { ServerProfile } from "@/federation/core/session.js";
import { CliError } from "@/shared/CliError.js";

/** 一次 release 启动所需的完整参数。 */
export interface LocalReleaseLaunch {
  /** 所属 Federation 的稳定 ID。 */
  fed_id: string;
  /** 本次已校验发布的 ID。 */
  release_id: string;
  /** 本次启动唯一身份。 */
  instance_id: string;
  /** 安装产物的绝对目录。 */
  release_dir: string;
  /** 产物内相对 JavaScript 入口。 */
  entry: string;
  /** 独立私有配置绝对路径；系统服务定义只保存引用，不保存配置内容。 */
  runtime_config_path: string;
  /** 是否随用户服务管理器启动，默认关闭。 */
  auto_start: boolean;
  /** 是否由系统恢复异常退出，默认开启。 */
  restart_on_failure: boolean;
  /** 监听地址。 */
  host: string;
  /** 固定监听端口。 */
  port: number;
  /** 对外管理 URL。 */
  base_url: string;
  /** 合并日志绝对路径。 */
  log_path: string;
}

/** 构造当前用户服务描述，路径与身份由稳定 Fed ID 导出。 */
function service_spec(fed_id: string, auto_start: boolean, restart_on_failure: boolean): SystemServiceSpec {
  const paths = service_runtime_paths(fed_id);
  return { fed_id, node_path: process.execPath,
    runner_path: fileURLToPath(new URL("../process/ServiceRunner.js", import.meta.url)),
    config_path: paths.config_path, service_dir: paths.service_dir,
    log_path: `${paths.service_dir}/supervisor.log`, auto_start, restart_on_failure };
}

/** 在切换前只读检查用户级托管器是否可用，不安装或启停服务。 */
export async function preflight_release_service(fed_id: string): Promise<void> {
  await inspect_system_service(service_spec(fed_id, false, true));
}

/** 系统启动已安装版本；失败时先清理，清理也失败则同时保留两项错误。 */
export async function start_release_process(input: LocalReleaseLaunch): Promise<{
  /** 本次系统托管主进程 PID。 */
  pid: number;
  /** 运行器生成的本次实例身份，自动恢复时也会重新生成。 */
  instance_id: string;
}> {
  const paths = service_runtime_paths(input.fed_id);
  const spec = service_spec(input.fed_id, input.auto_start, input.restart_on_failure);
  resolve_system_service(spec); // 在写控制文件前拒绝不支持的平台和不可用用户域。
  const config: ServiceRuntimeConfig = { schema: 1, fed_id: input.fed_id,
    launch_id: input.instance_id, release_id: input.release_id, release_dir: input.release_dir,
    entry: input.entry, runtime_config_path: input.runtime_config_path,
    host: input.host, port: input.port, base_url: input.base_url, log_path: input.log_path,
    receipt_path: paths.receipt_path, attempts_path: paths.attempts_path,
    restart_on_failure: input.restart_on_failure };
  await mkdir(dirname(input.log_path), { recursive: true, mode: 0o700 });
  await write_service_json(paths.config_path, config);
  await rm(paths.receipt_path, { force: true });
  await rm(paths.attempts_path, { force: true });
  try {
    await start_system_service(spec);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const receipt = await read_service_receipt(config);
      const state = await inspect_system_service(spec);
      if (receipt?.state === "rate_limited") throw new Error("System service reached its restart limit");
      if (receipt && state.active && state.pid === receipt.pid && ["starting", "running"].includes(receipt.state)) {
        return { pid: receipt.pid, instance_id: receipt.instance_id };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("System service did not produce a matching runtime receipt");
  } catch (start_error) {
    try {
      await stop_system_service(spec);
    } catch (cleanup_error) {
      throw new AggregateError([start_error, cleanup_error], "Local release start and cleanup failed");
    }
    throw start_error;
  }
}

/** 判断进程是否存活；权限不足也视为存在，不接管未知进程。 */
export function is_local_process_alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** 从系统服务与私有运行记录读取实时状态，不凭登记 PID 猜测存活情况。 */
export async function inspect_release_process(server: ServerProfile): Promise<{
  /** 用户级托管器名称。 */
  manager: string;
  /** 托管器的可读状态。 */
  state: string;
  /** 是否处于活跃运行或恢复阶段。 */
  active: boolean;
  /** 最近一次运行器固定故障码，不包含日志正文或配置。 */
  failure_code?: string;
  /** 已匹配托管器主 PID 的运行记录，缺失时不宣称实例身份有效。 */
  identity?: { /** 系统主 PID。 */ pid: number; /** 当前运行器实例身份。 */ instance_id: string };
}> {
  if (!server.fed_id || server.target !== "local") throw new CliError({ title: "A managed local Federation is required" });
  const policy = server.config_snapshot?.deployment.process;
  const spec = service_spec(server.fed_id, policy?.auto_start ?? false, policy?.restart_on_failure ?? true);
  const info = resolve_system_service(spec);
  const state = await inspect_system_service(spec);
  if (!state.registered) return { manager: info.manager, state: state.state, active: false };
  const config = await read_service_config(spec.config_path);
  if (config.fed_id !== server.fed_id || config.release_id !== server.release_id) {
    throw new CliError({ title: "System service release does not match the selected deployment" });
  }
  const receipt = await read_service_receipt(config);
  return { manager: info.manager, state: receipt?.state === "rate_limited" ? "rate_limited" : state.state,
    active: state.active,
    ...(receipt?.failure_code ? { failure_code: receipt.failure_code } : {}),
    ...(state.active && receipt && state.pid === receipt.pid && ["starting", "running"].includes(receipt.state)
      ? { identity: { pid: receipt.pid, instance_id: receipt.instance_id } } : {}),
  };
}

/** 主动停止交给系统托管器，并移除自动启动关联，防止恢复策略重新拉起。 */
export async function stop_release_process(server: ServerProfile | undefined): Promise<boolean> {
  if (!server?.fed_id || server.target !== "local") return false;
  const policy = server.config_snapshot?.deployment.process;
  const spec = service_spec(server.fed_id, policy?.auto_start ?? false, policy?.restart_on_failure ?? true);
  await stop_system_service(spec);
  const state = await inspect_system_service(spec);
  return !state.active;
}

/** 请求本次启动的就绪身份，拒绝旧服务或其他版本的成功响应。 */
export async function wait_for_release_ready(server: ServerProfile, timeout_ms = 15_000): Promise<void> {
  if (!server.fed_id || !server.release_id || !server.instance_id || !server.pid) {
    throw new CliError({ title: "Release identity is incomplete" });
  }
  const deadline = Date.now() + timeout_ms;
  let detail = "No matching ready response";
  while (Date.now() < deadline) {
    const process_state = await inspect_release_process(server);
    if (process_state.state === "rate_limited") throw new Error("System service reached its restart limit");
    if (!process_state.identity) {
      detail = `System service is ${process_state.state}; no matching live instance`;
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    server.pid = process_state.identity.pid;
    server.instance_id = process_state.identity.instance_id;
    try {
      const response = await fetch(`${server.base_url.replace(/\/+$/u, "")}/health`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2_000, deadline - Date.now()))), redirect: "manual",
      });
      if (!response.ok) { detail = `Health HTTP ${response.status}`; await response.body?.cancel(); }
      else {
        const health = await response.json() as Record<string, unknown>;
        if (health.ok === true && health.fed_id === server.fed_id && health.release_id === server.release_id
          && health.instance_id === server.instance_id && is_local_process_alive(server.pid)) return;
        detail = "Health response does not match this Federation, release and instance, or is not ready";
      }
    } catch { detail = "Health request failed or timed out"; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(detail);
}
