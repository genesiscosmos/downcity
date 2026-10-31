/**
 * Local Federation 部署器。
 *
 * 关键说明（中文）
 * - Local 不是开发捷径，而是 `fed deploy` 的正式部署目标。
 * - 同一 fed_id 重复部署会先构建最新代码，再替换旧的受管实例。
 * - 端口缺省固定为 12314，只接受配置显式覆盖；占用时报错，运行状态写入 registry。
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { allocateAvailablePort } from "@/city/process/daemon/PortAllocator.js";
import { DEFAULT_LOCAL_FEDERATION_PORT } from "@/federation/deploy/config/FederationProjectConfigReader.js";
import { build_node_release, read_node_release } from "@/federation/deploy/release/NodeReleaseBuilder.js";
import { local_release_paths, ensure_local_release_paths, install_local_release, activate_local_release, read_current_release, with_local_release_lock } from "@/federation/deploy/release/LocalReleaseStore.js";
import { preview_local_runtime_config, commit_local_runtime_config, read_local_runtime_config } from "@/federation/deploy/release/LocalRuntimeConfig.js";
import { begin_local_deployment, advance_local_deployment, finish_local_deployment, read_local_deployment_record, type LocalDeploymentTracker } from "@/federation/deploy/release/LocalDeploymentRecord.js";
import { start_release_process, stop_release_process, wait_for_release_ready, is_local_process_alive, inspect_release_process, preflight_release_service } from "@/federation/deploy/release/LocalReleaseProcess.js";
import {
  read_server_by_fed_id,
  register_deployed_server,
  updateServer,
  type ServerProfile,
} from "@/federation/core/session.js";
import { runCommand } from "@/federation/deploy/runtime/CommandRunner.js";
import { runPackageDeployScripts } from "@/federation/deploy/runtime/PackageScriptRunner.js";
import type {
  FederationDeployOptions,
  FederationProjectConfigFile,
} from "@/federation/types/FederationProjectConfig.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { CliError } from "@/shared/CliError.js";
import {
  create_admin_deployment_credentials,
  show_admin_credentials_configured,
  verify_admin_deployment_credentials,
} from "@/federation/deploy/runtime/AdminCredentials.js";
import { provision_local_admin_database } from "@/federation/deploy/runtime/AdminDatabaseProvisioner.js";


/** 构建独立产物；实际发布只在取得部署锁后进入安装与进程切换。 */
export async function deploy_local_federation(
  config_file: FederationProjectConfigFile,
  options: FederationDeployOptions,
): Promise<void> {
  const config = config_file.config;
  emitCliBlock({
    tone: "accent", title: "Project",
    facts: [
      { label: "id", value: config.id }, { label: "name", value: config.name },
      { label: "target", value: "local" }, { label: "source", value: config_file.project_dir },
    ],
  });
  if (options.verify_only) {
    const server = read_server_by_fed_id(config.id, "local");
    if (!server) throw new CliError({ title: "Local Federation is not deployed" });
    await wait_for_release_ready(server, 3_000);
    emitCliBlock({ tone: "success", title: "Local Federation verified", facts: [{ label: "url", value: server.base_url }] });
    return;
  }
  if (options.dry_run) {
    await build_and_deploy(config_file, options);
    return;
  }
  // 构建也纳入同 Fed 操作锁，失败记录不会被并发停止或另一次部署覆盖。
  await with_local_release_lock(config.id, async () => {
    const tracker = await begin_local_deployment(config.id);
    try {
      await build_and_deploy(config_file, options, tracker);
      await finish_local_deployment(tracker, "succeeded");
    } catch (error) {
      const phase = tracker.record.latest.phase;
      const cutover_started = tracker.record.latest.cutover_started;
      try { await finish_local_deployment(tracker, "failed", tracker.record.latest.cleanup); }
      catch (record_error) { throw new CliError({ title: "Local deployment and failure recording failed",
        note: `${error_summary(error)}; ${error_summary(record_error)}`, fix: "Inspect the system service and deployment.json before retrying." }); }
      throw new CliError({ title: "Local Federation deployment failed",
        note: `Phase: ${phase}. ${error_summary(error)}`,
        fix: cutover_started
          ? "Inspect status and logs. Service availability must be checked; no automatic rollback was attempted."
          : "The previous service and runtime configuration were not changed by this deployment.",
      });
    }
    const server = read_server_by_fed_id(config.id, "local");
    emitCliBlock({ tone: "success", title: "Local Federation deployed",
      facts: [{ label: "url", value: server?.base_url ?? "not recorded" },
        { label: "release", value: tracker.record.latest.release_id ?? "not recorded" },
        { label: "artifact", value: server?.release_dir ?? "not recorded" },
        { label: "pid", value: String(server?.pid ?? "unknown") }],
      note: `Operation: ${tracker.record.latest.operation_id}`,
    });
  });
}

/** 在临时目录完成构建校验，dry-run 不创建部署记录或修改运行配置。 */
async function build_and_deploy(config_file: FederationProjectConfigFile, options: FederationDeployOptions,
  tracker?: LocalDeploymentTracker): Promise<void> {
  if (config_file.config.deployment.scripts?.deploy) throw new CliError({
    title: "Local releases do not support shell deploy scripts",
    fix: "Remove deployment.scripts.deploy; the packaged entry is executed directly by Node.",
  });
  await run_local_build(config_file, options);
  const staging_dir = await mkdtemp(join(tmpdir(), "downcity-node-release-"));
  try {
    if (tracker) await advance_local_deployment(tracker, "package");
    const manifest = await build_node_release(config_file, staging_dir);
    if (tracker) await advance_local_deployment(tracker, "validate", { release_id: manifest.release_id });
    await read_node_release(staging_dir, config_file.config.id, manifest.release_id);
    if (options.dry_run) {
      emitCliBlock({ tone: "success", title: "Local deployment dry-run", facts: [{ label: "status", value: "artifact validated" }],
        note: "Release built and verified; no local process was started or runtime configuration changed." });
    } else {
      if (!tracker) throw new Error("A deployment tracker is required");
      await install_and_start_release(config_file, staging_dir, manifest.release_id, options.admin_reset, tracker);
    }
  } finally { await rm(staging_dir, { recursive: true, force: true }); }
}

/** 合并启动、清理及记录错误的说明，不把任意错误对象序列化为持久状态。 */
function error_summary(error: unknown): string {
  if (error instanceof AggregateError) return error.errors.map(error_summary).join("; ");
  if (error instanceof CliError) return `${error.message}${error.note ? ` (${error.note})` : ""}`;
  return error instanceof Error ? error.message : "Unknown deployment error";
}

/** 先完成配置、产物和身份检查，再进入不可并发的进程切换。 */
async function install_and_start_release(
  config_file: FederationProjectConfigFile,
  built_dir: string,
  release_id: string,
  admin_reset: boolean,
  tracker: LocalDeploymentTracker,
): Promise<void> {
  const config = config_file.config;
  const previous = read_server_by_fed_id(config.id, "local");
  await advance_local_deployment(tracker, "preflight");
  await preflight_release_service(config.id);
  const previous_process = previous ? await inspect_release_process(previous) : undefined;
  if (previous?.pid && is_local_process_alive(previous.pid) && !previous_process?.active) {
    throw new CliError({ title: "The registered process is not owned by the system service manager",
      fix: "Verify and explicitly stop the unmanaged process before deploying this service." });
  }
  const paths = local_release_paths(config.id);
  const runtime = preview_local_runtime_config(config_file.project_dir, paths.config_dir, paths.data_dir);
  const host = config.deployment.host?.trim() || "127.0.0.1";
  const port = config.deployment.port ?? DEFAULT_LOCAL_FEDERATION_PORT;
  const base_url = config.deployment.url?.trim() || `http://${url_host(host)}:${port}`;
  if (!previous_process?.active || previous?.port !== port
    || (previous?.config_snapshot?.deployment.host?.trim() || "127.0.0.1") !== host) {
    await resolve_local_port(port, host);
  }
  // 所有交互输入都在停止旧实例之前完成，取消不会进入数据准备。
  const credentials = admin_reset || !previous?.admin_id
    ? await create_admin_deployment_credentials(admin_reset ? "reset" : "initialize") : undefined;
  await advance_local_deployment(tracker, "install");
  await ensure_local_release_paths(paths);
  // 产物先复制到部署文件系统上的 staging，保证最终 rename 原子完成。
  const { cp } = await import("node:fs/promises");
  const staging_dir = await mkdtemp(join(paths.staging_dir, "install-"));
  let release_dir: string;
  try {
    await cp(built_dir, staging_dir, { recursive: true, errorOnExist: false, verbatimSymlinks: true });
    await read_node_release(staging_dir, config.id, release_id);
    release_dir = await install_local_release(staging_dir, paths, release_id);
  } finally { await rm(staging_dir, { recursive: true, force: true }); }
  const manifest = await read_node_release(release_dir, config.id, release_id);
  await advance_local_deployment(tracker, "stop", { cutover_started: true });
  if (previous) {
    const stopped = await stop_release_process(previous);
    if (!stopped) throw new CliError({ title: "Unable to stop previous local Federation" });
    updateServer(previous.base_url, { ...previous, status: "stopped" });
  }
  await resolve_local_port(port, host);
  await advance_local_deployment(tracker, "prepare");
  // 此处开始可能修改数据库；失败时保留事实，不自动拉起不兼容的旧代码。
  commit_local_runtime_config(runtime);
  const admin_result = credentials
    ? provision_local_admin_database(config_file.project_dir, credentials, runtime.database_path) : undefined;
  const admin_id = admin_result?.admin_id ?? previous?.admin_id;
  const input = { config, project_dir: config_file.project_dir, base_url, port,
    log_path: paths.log_path, admin_id, release_id, release_dir,
    runtime_config_path: runtime.config_path, data_dir: paths.data_dir };
  const server: ServerProfile = { ...input, name: config.name, fed_id: config.id, target: "local", status: "starting" };
  await advance_local_deployment(tracker, "start", { candidate_started: true });
  try {
    const identity = await start_release_process({ fed_id: config.id, release_id,
      instance_id: `fed_instance_${randomUUID().replace(/-/gu, "")}`, release_dir,
      entry: manifest.entry, runtime_config_path: runtime.config_path,
      auto_start: config.deployment.process?.auto_start ?? false,
      restart_on_failure: config.deployment.process?.restart_on_failure ?? true,
      host, port, base_url, log_path: paths.log_path });
    server.pid = identity.pid;
    server.instance_id = identity.instance_id;
    register_deployed_server({ ...input, pid: server.pid, instance_id: server.instance_id, status: "starting" });
    await advance_local_deployment(tracker, "ready");
    await wait_for_release_ready(server);
    if (credentials && admin_result?.credentials_applied) {
      if (!await verify_admin_deployment_credentials(base_url, credentials)) throw new Error("Administrator verification failed");
      show_admin_credentials_configured();
    }
    await advance_local_deployment(tracker, "activate");
    register_deployed_server({ ...input, pid: server.pid, instance_id: server.instance_id, status: "running" });
    await activate_local_release(paths, release_id);
  } catch (error) {
    const errors: unknown[] = [error];
    tracker.record.latest.cleanup = "unknown";
    try {
      if (await stop_release_process(server)) tracker.record.latest.cleanup = "stopped";
      else errors.push(new Error("Candidate cleanup could not confirm the service is stopped"));
    } catch (cleanup_error) { errors.push(cleanup_error); }
    try { register_deployed_server({ ...input, pid: server.pid, instance_id: server.instance_id, status: "failed" }); }
    catch (record_error) { errors.push(record_error); }
    throw new AggregateError(errors, "Candidate deployment failed; inspect recorded phase and cleanup result");
  }
}

/** 执行自定义构建脚本或目标默认 package scripts。 */
async function run_local_build(
  config_file: FederationProjectConfigFile,
  options: FederationDeployOptions,
): Promise<void> {
  if (options.skip_build && options.skip_typecheck) return;
  const custom_build = config_file.config.deployment.scripts?.build?.trim();
  if (custom_build && !options.skip_build) {
    await runCommand({
      label: "Federation build",
      command: custom_build,
      cwd: config_file.project_dir,
      capture: true,
    });
    return;
  }
  await runPackageDeployScripts({
    project_dir: config_file.project_dir,
    skip_build: options.skip_build,
    skip_typecheck: options.skip_typecheck,
  });
}

/** 单 Fed 操作锁内停止可信实例，并将结果写回最新记录。 */
export async function stop_managed_local_server(server: ServerProfile | undefined): Promise<boolean> {
  if (!server?.fed_id || server.target !== "local") return false;
  return await with_local_release_lock(server.fed_id, async () => {
    const current = read_server_by_fed_id(server.fed_id!, "local");
    if (!current || current.base_url !== server.base_url) throw new CliError({ title: "Federation deployment changed; select it again" });
    const stopped = await stop_release_process(current);
    if (stopped) updateServer(current.base_url, { ...current, status: "stopped" });
    return stopped;
  });
}

/** 只从登记的 release 启动，原源码目录不存在也不影响重启。 */
export async function restart_managed_local_server(server: ServerProfile): Promise<void> {
  if (!server.fed_id || server.target !== "local") throw new CliError({ title: "A managed local Federation is required" });
  await with_local_release_lock(server.fed_id, async () => {
    const current = read_server_by_fed_id(server.fed_id!, "local");
    if (!current || current.base_url !== server.base_url) throw new CliError({ title: "Federation deployment changed; select it again" });
    if (!current.release_dir || !current.release_id || !current.runtime_config_path || !current.port || !current.log_path) {
      throw new CliError({ title: "This deployment has no independent release",
        fix: "Explicitly deploy the project with fed deploy --path <path>; restart never falls back to source files." });
    }
    const history = await read_local_deployment_record(current.fed_id!);
    if (history?.recovery_required) {
      throw new CliError({ title: "The last deployment cutover did not complete successfully",
        fix: "Inspect the failed or interrupted operation and explicitly deploy a verified release; restart never performs rollback." });
    }
    const paths = local_release_paths(current.fed_id!);
    const active_release_id = await read_current_release(paths);
    // 失败发布可能已经更新配置或数据库；不能隐式用旧代码搭配新配置恢复。
    if (active_release_id !== current.release_id) {
      throw new CliError({ title: "The last deployment did not activate successfully",
        fix: "Inspect the failed deployment and explicitly deploy a verified release; restart does not perform rollback." });
    }
    const release_dir = join(paths.releases_dir, active_release_id);
    const manifest = await read_node_release(release_dir, current.fed_id, active_release_id);
    const runtime_env = read_local_runtime_config(current.runtime_config_path);
    try {
      if (!runtime_env.DATABASE_PATH || !(await stat(runtime_env.DATABASE_PATH)).isFile()) throw new Error("Missing database");
    } catch {
      throw new CliError({ title: "The deployed SQLite database is missing",
        fix: "Restore the registered database before restarting; no empty replacement will be created." });
    }
    const host = current.config_snapshot?.deployment.host?.trim() || "127.0.0.1";
    const process_state = await inspect_release_process(current);
    if (!process_state.active) await resolve_local_port(current.port, host);
    if (!await stop_release_process(current)) throw new CliError({ title: "Unable to stop previous instance" });
    updateServer(current.base_url, { ...current, status: "stopped" });
    const port = await resolve_local_port(current.port, host);
    const instance_id = `fed_instance_${randomUUID().replace(/-/gu, "")}`;
    const identity = await start_release_process({ fed_id: current.fed_id!, release_id: active_release_id,
      release_dir, instance_id, entry: manifest.entry, runtime_config_path: current.runtime_config_path,
      auto_start: current.config_snapshot?.deployment.process?.auto_start ?? false,
      restart_on_failure: current.config_snapshot?.deployment.process?.restart_on_failure ?? true,
      host, port, base_url: current.base_url, log_path: current.log_path });
    const next = { ...current, release_id: active_release_id, release_dir,
      instance_id: identity.instance_id, pid: identity.pid, status: "starting" as const };
    try {
      updateServer(current.base_url, next);
      await wait_for_release_ready(next);
      updateServer(current.base_url, { ...next, status: "running" });
    } catch (error) {
      await stop_release_process(next);
      updateServer(current.base_url, { ...next, status: "failed" });
      throw new CliError({ title: "Local Federation restart failed",
        note: error instanceof Error ? error.message : String(error), fix: `Inspect ${current.log_path}` });
    }
  });
}

/** 只校验用户端口或固定默认端口；端口冲突时不改用其他端口。 */
async function resolve_local_port(
  configured_port: number | undefined,
  host: string,
): Promise<number> {
  const port = configured_port ?? DEFAULT_LOCAL_FEDERATION_PORT;
  try {
    return await allocateAvailablePort({ start: port, end: port, host });
  } catch {
    throw new CliError({
      title: "Local Federation port is unavailable",
      note: `Cannot listen on ${host}:${port}.`,
      fix: "Check the process using this port or explicitly set deployment.port in federation.toml.",
    });
  }
}

/** 将监听地址转换为本机可请求 URL host。 */
function url_host(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
