/**
 * Local Federation 部署器。
 *
 * 关键说明（中文）
 * - Local 不是开发捷径，而是 `fed deploy` 的正式部署目标。
 * - 同一 fed_id 重复部署会先构建最新代码，再替换旧的受管实例。
 * - 端口默认从 12314 开始分配，运行状态写入系统级 Federation registry。
 */

import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allocateAvailablePort } from "@/city/process/daemon/PortAllocator.js";
import { getPlatformRootDirPath } from "@/city/process/registry/CityPaths.js";
import { signalDetachedProcess } from "@/city/process/registry/ProcessSweep.js";
import {
  read_server_by_fed_id,
  register_deployed_server,
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
  show_admin_credentials_once,
  verify_admin_deployment_credentials,
} from "@/federation/deploy/runtime/AdminCredentials.js";
import { provision_local_admin_database } from "@/federation/deploy/runtime/AdminDatabaseProvisioner.js";
import { with_cli_progress } from "@/shared/CliProgress.js";

const LOCAL_PORT_START = 12314;
const LOCAL_PORT_END = 13313;
const LOCAL_HEALTH_TIMEOUT_MS = 15_000;

/** 部署并登记一个 Local Federation。 */
export async function deploy_local_federation(
  config_file: FederationProjectConfigFile,
  options: FederationDeployOptions,
): Promise<void> {
  const config = config_file.config;
  const deployment = config.deployment;
  const previous = read_server_by_fed_id(config.id, "local");

  emitCliBlock({
    tone: "accent",
    title: "Project",
    facts: [
      { label: "id", value: config.id },
      { label: "name", value: config.name },
      { label: "target", value: deployment.target },
      { label: "source", value: config_file.project_dir },
    ],
  });

  if (options.verify_only) {
    await verify_local_server(previous?.base_url, previous?.log_path);
    return;
  }

  await run_local_build(config_file, options);
  if (options.dry_run) {
    emitCliBlock({
      tone: "success",
      title: "Local deployment dry-run",
      facts: [{ label: "status", value: "validated" }],
      note: "Build completed; no local process was started.",
    });
    return;
  }

  await stop_previous_local_server(previous);
  const host = deployment.host?.trim() || "127.0.0.1";
  const port = await resolve_local_port(deployment.port, previous?.port, host);
  const base_url = deployment.url?.trim() || `http://${url_host(host)}:${port}`;
  const instance_id = `fed_instance_${randomUUID().replace(/-/gu, "")}`;
  const admin_credentials = options.admin_reset || !previous?.admin_id
    ? await create_admin_deployment_credentials(options.admin_reset ? "reset" : "initialize")
    : undefined;
  const admin_result = admin_credentials
    ? await with_cli_progress({
        title: options.admin_reset
          ? "Reset local Federation administrator"
          : "Initialize local Federation administrator",
        detail: "SQLite transaction",
      }, async () => provision_local_admin_database(config_file.project_dir, admin_credentials))
    : undefined;
  const log_path = resolve_local_log_path(config.id);
  const command = deployment.scripts?.deploy?.trim() || "pnpm start";
  const pid = start_local_process({
    fed_id: config.id,
    instance_id,
    project_dir: config_file.project_dir,
    command,
    host,
    port,
    base_url,
    log_path,
  });

  register_deployed_server({
    config,
    project_dir: config_file.project_dir,
    base_url,
    pid,
    instance_id,
    port,
    log_path,
    status: "starting",
    admin_id: previous?.admin_id,
  });

  try {
    await with_cli_progress({
      title: "Wait for local Federation",
      detail: `${base_url}/health`,
    }, async () => await wait_for_health(base_url, LOCAL_HEALTH_TIMEOUT_MS));
  } catch (error) {
    stop_local_process(pid);
    register_deployed_server({
      config,
      project_dir: config_file.project_dir,
      base_url,
      instance_id,
      port,
      log_path,
      status: "failed",
      admin_id: previous?.admin_id,
    });
    throw new CliError({
      title: "Local Federation failed to start",
      note: error instanceof Error ? error.message : String(error),
      fix: `Inspect ${log_path}`,
    });
  }

  let provisioned_admin_id = admin_result?.admin_id ?? previous?.admin_id;
  if (admin_credentials && admin_result?.credentials_applied) {
    const verified = await with_cli_progress({
      title: "Verify Federation administrator",
      detail: `${base_url}/v1/admin/login`,
    }, async () => await verify_admin_deployment_credentials(base_url, admin_credentials));
    if (!verified) {
      stop_local_process(pid);
      throw new CliError({
        title: "Federation administrator database update could not be verified",
        note: "SQLite accepted the administrator update, but the local Federation rejected the new credentials.",
      });
    }
    provisioned_admin_id = admin_credentials.admin_id;
    show_admin_credentials_once(admin_credentials);
  }

  register_deployed_server({
    config,
    project_dir: config_file.project_dir,
    base_url,
    pid,
    instance_id,
    port,
    log_path,
    status: "running",
    admin_id: provisioned_admin_id,
  });
  emitCliBlock({
    tone: "success",
    title: "Local Federation deployed",
    facts: [
      { label: "url", value: base_url },
      { label: "pid", value: String(pid) },
      { label: "port", value: String(port) },
      { label: "status", value: "running" },
      { label: "admin", value: provisioned_admin_id ?? "existing credentials required" },
    ],
    note: `Log: ${log_path}`,
  });
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

/** 停止同一 fed_id 的旧受管进程。 */
async function stop_previous_local_server(
  previous: ReturnType<typeof read_server_by_fed_id>,
): Promise<void> {
  if (!previous?.pid || !previous.instance_id) return;
  if (!is_process_alive(previous.pid)) return;
  if (!is_expected_launcher(previous.pid, previous.fed_id ?? "", previous.instance_id)) {
    throw new CliError({
      title: "Refusing to stop an unverified local process",
      note: `PID ${previous.pid} no longer matches ${previous.instance_id}.`,
      fix: "Remove the stale Federation entry from `fed server` and deploy again.",
    });
  }
  stop_local_process(previous.pid);
  const deadline = Date.now() + 3_000;
  while (is_process_alive(previous.pid) && Date.now() < deadline) {
    await delay(100);
  }
  if (is_process_alive(previous.pid)) {
    signalDetachedProcess(previous.pid, "SIGKILL");
  }
}

/** 停止 `fed server` 管理的 Local Federation 实例。 */
export async function stop_managed_local_server(
  server: ReturnType<typeof read_server_by_fed_id>,
): Promise<boolean> {
  if (!server || server.target !== "local" || !server.pid || !server.instance_id) return false;
  if (!is_process_alive(server.pid)) return true;
  if (!is_expected_launcher(server.pid, server.fed_id ?? "", server.instance_id)) {
    throw new CliError({
      title: "Refusing to stop an unverified local process",
      note: `PID ${server.pid} does not match ${server.instance_id}.`,
      fix: "Remove the stale registry entry without terminating the unrelated process.",
    });
  }
  stop_local_process(server.pid);
  const deadline = Date.now() + 3_000;
  while (is_process_alive(server.pid) && Date.now() < deadline) await delay(100);
  if (is_process_alive(server.pid)) signalDetachedProcess(server.pid, "SIGKILL");
  return !is_process_alive(server.pid);
}

/** 解析显式端口、历史端口或新的可用端口。 */
async function resolve_local_port(
  configured_port: number | undefined,
  previous_port: number | undefined,
  host: string,
): Promise<number> {
  if (configured_port !== undefined) {
    return await allocateAvailablePort({ start: configured_port, end: configured_port, host });
  }
  if (previous_port !== undefined) {
    try {
      return await allocateAvailablePort({ start: previous_port, end: previous_port, host });
    } catch {
      // 历史端口被其他程序占用时继续从默认范围分配。
    }
  }
  return await allocateAvailablePort({ start: LOCAL_PORT_START, end: LOCAL_PORT_END, host });
}

/** 启动携带实例身份的后台 launcher。 */
function start_local_process(input: {
  fed_id: string;
  instance_id: string;
  project_dir: string;
  command: string;
  host: string;
  port: number;
  base_url: string;
  log_path: string;
}): number {
  mkdirSync(join(getPlatformRootDirPath(), "federation", "logs"), { recursive: true });
  const log_fd = openSync(input.log_path, "a");
  const launcher_path = fileURLToPath(new URL("./LocalProcessLauncher.js", import.meta.url));
  const child = spawn(process.execPath, [
    launcher_path,
    "--fed-id", input.fed_id,
    "--instance-id", input.instance_id,
    "--project-dir", input.project_dir,
    "--command", input.command,
  ], {
    cwd: input.project_dir,
    detached: true,
    env: {
      ...process.env,
      HOST: input.host,
      PORT: String(input.port),
      DOWNCITY_FEDERATION_BASE_URL: input.base_url,
      DOWNCITY_FED_INSTANCE_ID: input.instance_id,
    },
    stdio: ["ignore", log_fd, log_fd],
  });
  child.unref();
  closeSync(log_fd);
  if (!child.pid) throw new Error("Unable to read Local Federation PID.");
  return child.pid;
}

/** 请求标准 `/health`，直到成功或超时。 */
async function wait_for_health(base_url: string, timeout_ms: number): Promise<void> {
  const health_url = `${base_url.replace(/\/+$/gu, "")}/health`;
  const deadline = Date.now() + timeout_ms;
  let last_error = "health endpoint did not respond";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(health_url);
      if (response.ok) return;
      last_error = `${health_url} returned HTTP ${response.status}`;
    } catch (error) {
      last_error = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(last_error);
}

/** 验证已登记 Local Federation。 */
async function verify_local_server(base_url: string | undefined, log_path: string | undefined): Promise<void> {
  if (!base_url) {
    throw new CliError({
      title: "Local Federation is not deployed",
      fix: "Run `fed deploy` first.",
    });
  }
  try {
    await wait_for_health(base_url, 3_000);
  } catch (error) {
    throw new CliError({
      title: "Local Federation health check failed",
      note: error instanceof Error ? error.message : String(error),
      fix: log_path ? `Inspect ${log_path}` : "Run `fed deploy` again.",
    });
  }
  emitCliBlock({
    tone: "success",
    title: "Local Federation verified",
    facts: [{ label: "url", value: base_url }, { label: "status", value: "healthy" }],
  });
}

/** 判断 PID 是否仍属于指定 launcher 实例。 */
function is_expected_launcher(pid: number, fed_id: string, instance_id: string): boolean {
  try {
    const command = process.platform === "win32"
      ? execFileSync(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${String(pid)}').CommandLine`,
          ],
          { encoding: "utf8", windowsHide: true },
        )
      : execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return command.includes("LocalProcessLauncher")
      && command.includes(fed_id)
      && command.includes(instance_id);
  } catch {
    return false;
  }
}

/** 判断 PID 是否存活。 */
function is_process_alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 终止 launcher 所在进程组。 */
function stop_local_process(pid: number): void {
  signalDetachedProcess(pid, "SIGTERM");
}

/** 生成系统级日志路径。 */
function resolve_local_log_path(fed_id: string): string {
  return join(getPlatformRootDirPath(), "federation", "logs", `${fed_id}.log`);
}

/** 将监听地址转换为本机可请求 URL host。 */
function url_host(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** 小间隔异步等待。 */
async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
