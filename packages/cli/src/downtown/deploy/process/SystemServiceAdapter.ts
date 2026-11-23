/**
 * Downtown user-service adapter for macOS gui/<uid> and Linux systemd --user.
 *
 * resolve is read-only; install stages an internal template without loading it.
 * start is the explicit install/register/start transaction. stop removes login
 * startup and unloads/stops the job, retaining a template and disabled marker.
 * Only a later explicit start restores startup according to auto_start.
 *
 * Definitions contain paths only. The runner owns bounded supervisor and application
 * logs; systemd's journal retains early runtime diagnostics. The runner owns working directory
 * and must enforce an additional crash-rate limit
 * on launchd (ThrottleInterval is only a delay, not a crash-count limit).
 * All manager commands use execFile with a ten-second timeout, never a shell.
 * No commands execute when this module is imported or definitions are resolved.
 */
import { constants, realpathSync as realpath_sync } from "node:fs";
import { access, lstat, mkdir, readFile as read_file, readlink, rename, rm, writeFile as write_file } from "node:fs/promises";
import { createHash as create_hash, randomUUID as random_uuid } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute as is_absolute, join, normalize, resolve } from "node:path";
import { is_owned_definition, render_system_service } from "./SystemServiceDefinition.js";
import {
  is_missing_launchd_service, launchd_arguments, launchd_field, parse_systemd_properties,
  require_service_success, run_service_command,
} from "./SystemServiceCommand.js";

/** All inputs belong to the current OS user; no service-level secrets are accepted. */
export interface SystemServiceSpec {
  /** Stable Downtown identity; hashed into an unambiguous manager service ID. */
  fed_id: string;
  /** Absolute Node executable path, resolved through symlinks for ownership checks. */
  node_path: string;
  /** Absolute runner entry path; executed as node runner --config config. */
  runner_path: string;
  /** Absolute runner configuration path; contents are never copied into definitions. */
  config_path: string;
  /** Absolute bounded supervisor log path reserved for the runner, never a launchd file descriptor. */
  log_path: string;
  /** Absolute private directory retaining the owned template and disabled marker. */
  service_dir: string;
  /** Restore login/manager startup on explicit start; explicit stop always disables it. */
  auto_start: boolean;
  /** Restart nonzero exits, with manager throttling; never overrides an explicit stop. */
  restart_on_failure: boolean;
}

/** Deterministic addresses and paths for this user's service, without registering it. */
export interface SystemServiceInfo {
  /** Stable launchd label or systemd unit filename, derived only from fed_id. */
  id: string;
  /** Native user service manager selected from process.platform. */
  manager: "launchd" | "systemd";
  /** Definition actually loaded on start, depending on manager and auto_start. */
  definition_path: string;
}

/** Internal paths and manager addresses; deliberately absent from the public result. */
interface SystemServiceDetails extends SystemServiceInfo {
  /** Numeric ID of the effective OS user owning the service manager. */
  uid: number;
  /** launchd gui/<uid> domain or systemd's user-manager scope. */
  domain: string;
  /** Fully qualified launchd service target or systemd unit filename. */
  service_target: string;
  /** Private staged definition, always retained after an explicit stop. */
  template_path: string;
  /** Persistent user-manager definition; removed on launchd stop. */
  startup_path: string;
  /** Private marker recording the intent to remain stopped across login/restarts. */
  disabled_path: string;
}

/** Manager observation only; inspection never reloads, enables, or repairs a service. */
export interface SystemServiceStatus {
  /** True when a launchd job or a systemd unit definition is known to the manager. */
  registered: boolean;
  /** True only when the manager reports running and a positive main PID. */
  active: boolean;
  /** Positive manager-reported main PID, omitted when no main process is running. */
  pid?: number;
  /** Native manager state, or not-found when the service is absent. */
  state: string;
}

/** Reject control characters and canonicalize even paths whose leaf does not exist. */
function canonical_path(value: string): string {
  if (!is_absolute(value) || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("System service paths must be absolute and contain no control characters");
  }
  const normalized_path = normalize(value);
  try { return realpath_sync(normalized_path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent_path = dirname(normalized_path);
    if (parent_path === normalized_path) throw error;
    return join(canonical_path(parent_path), basename(normalized_path));
  }
}

/** Normalize all ownership paths consistently, including when inspecting/stopping. */
function normalize_spec(spec: SystemServiceSpec): SystemServiceSpec {
  if (typeof spec.fed_id !== "string" || !spec.fed_id.trim() || /[\u0000-\u001f\u007f]/u.test(spec.fed_id)) {
    throw new Error("A nonempty Downtown ID without control characters is required");
  }
  if (typeof spec.auto_start !== "boolean" || typeof spec.restart_on_failure !== "boolean") {
    throw new Error("auto_start and restart_on_failure must be booleans");
  }
  return { ...spec, node_path: canonical_path(spec.node_path), runner_path: canonical_path(spec.runner_path),
    config_path: canonical_path(spec.config_path), log_path: canonical_path(spec.log_path),
    service_dir: canonical_path(spec.service_dir) };
}

/** Resolve the current user's namespace and definition paths without any manager call. */
export function resolve_system_service(input: SystemServiceSpec): SystemServiceInfo {
  const { manager, id, definition_path } = resolve_service_details(input);
  return { manager, id, definition_path };
}

/** Resolve private lifecycle paths without expanding the public integration contract. */
function resolve_service_details(input: SystemServiceSpec): SystemServiceDetails {
  const spec = normalize_spec(input);
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("User services require macOS or Linux");
  const uid = process.getuid?.();
  if (uid === undefined || (process.geteuid && process.geteuid() !== uid)) throw new Error("Cannot resolve the current user service scope");
  const manager = process.platform === "darwin" ? "launchd" : "systemd";
  const identity = `org.downcity.downtown.${create_hash("sha256").update(spec.fed_id).digest("hex")}`;
  const id = manager === "launchd" ? identity : `${identity}.service`;
  const template_path = join(spec.service_dir, `${id}${manager === "launchd" ? ".plist" : ""}`);
  const config_home = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const startup_path = manager === "launchd"
    ? join(canonical_path(homedir()), "Library", "LaunchAgents", `${id}.plist`)
    : join(canonical_path(config_home), "systemd", "user", id);
  if (template_path === startup_path) throw new Error("service_dir must be separate from the manager's startup directory");
  const domain = manager === "launchd" ? `gui/${uid}` : "user";
  return { id, manager, uid, domain, service_target: manager === "launchd" ? `${domain}/${id}` : id,
    definition_path: manager === "launchd" && !spec.auto_start ? template_path : startup_path,
    template_path, startup_path, disabled_path: join(spec.service_dir, `${id}.disabled`) };
}

/** Read only regular files; never follow a definition symlink to an unknown service. */
async function read_definition(file_path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(file_path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refusing a non-regular service definition: ${file_path}`);
    return await read_file(file_path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** All existing definitions must match complete owned output, not a copied label/comment. */
async function validate_definitions(spec: SystemServiceSpec, info: SystemServiceDetails): Promise<void> {
  for (const file_path of [info.template_path, info.startup_path]) {
    const content = await read_definition(file_path);
    if (content !== undefined && !is_owned_definition(content, spec, info)) {
      throw new Error(`Refusing to replace or control an unowned definition: ${file_path}`);
    }
  }
  const marker = await read_definition(info.disabled_path);
  if (marker !== undefined && marker !== `${info.id}\n`) throw new Error(`Unowned disabled marker: ${info.disabled_path}`);
}

/** Serialize this adapter's mutations; a crashed lock is deliberately not stolen. */
async function with_service_lock(spec: SystemServiceSpec, operation: () => Promise<void>): Promise<void> {
  await mkdir(spec.service_dir, { recursive: true, mode: 0o700 });
  const lock_path = join(spec.service_dir, ".system-service.lock");
  await mkdir(lock_path, { mode: 0o700 });
  try { await operation(); } finally { await rm(lock_path, { recursive: true }); }
}

/** Atomic private-file replacement after ownership validation by the caller. */
async function write_definition(file_path: string, content: string): Promise<void> {
  await mkdir(dirname(file_path), { recursive: true, mode: 0o700 });
  const temporary_path = `${file_path}.${random_uuid()}.tmp`;
  try {
    await write_file(temporary_path, content, { flag: "wx", mode: 0o600 });
    await rename(temporary_path, file_path);
  } finally { await rm(temporary_path, { force: true }); }
}

/** Stage only. Loading is intentionally combined with explicit start on both OSes. */
export async function install_system_service(input: SystemServiceSpec): Promise<void> {
  const spec = normalize_spec(input);
  const info = resolve_service_details(spec);
  await with_service_lock(spec, async () => {
    await validate_definitions(spec, info);
    await write_definition(info.template_path, render_system_service(spec, info));
  });
}

/** Refuse mutations when the login domain/user manager itself is unavailable. */
async function validate_manager(info: SystemServiceDetails, check_disabled = false): Promise<void> {
  const result = info.manager === "launchd"
    ? await run_service_command("launchctl", ["print", info.domain])
    : await run_service_command("systemctl", ["--user", "show-environment"]);
  require_service_success(result, `Validate ${info.domain} service manager`);
  if (info.manager === "launchd" && check_disabled) {
    const disabled = await run_service_command("launchctl", ["print-disabled", info.domain]);
    require_service_success(disabled, "Inspect launchd disabled overrides");
    const override = disabled.stdout.split("\n").find((line) => line.includes(`"${info.id}" =>`));
    if (override && /=>\s*(?:true|disabled)/u.test(override)) {
      throw new Error(`Service ${info.id} is administratively disabled; refusing to change its override`);
    }
  }
}

/** Query and verify launchd's loaded definition and exact node/runner/config vector. */
async function inspect_launchd(spec: SystemServiceSpec, info: SystemServiceDetails): Promise<SystemServiceStatus> {
  const result = await run_service_command("launchctl", ["print", info.service_target]);
  if (is_missing_launchd_service(result)) return { registered: false, active: false, state: "not-found" };
  require_service_success(result, "Inspect launchd service");
  const loaded_path = launchd_field(result.stdout, "path");
  const program_path = launchd_field(result.stdout, "program");
  const arguments_list = launchd_arguments(result.stdout);
  const expected_arguments = [spec.node_path, spec.runner_path, "--config", spec.config_path];
  if (!loaded_path || ![info.template_path, info.startup_path].includes(loaded_path)
    || program_path !== spec.node_path || !arguments_list || arguments_list.length !== expected_arguments.length
    || arguments_list.some((argument, index) => argument !== expected_arguments[index])) {
    throw new Error(`Refusing an unowned loaded launchd job: ${info.service_target}`);
  }
  const content = await read_definition(loaded_path) ?? await read_definition(info.template_path);
  if (content === undefined || !is_owned_definition(content, spec, info)) throw new Error(`Unverified loaded definition: ${loaded_path}`);
  const state = launchd_field(result.stdout, "state");
  if (!state) throw new Error("launchctl print did not report a service state");
  const pid = positive_pid(launchd_field(result.stdout, "pid"));
  return { registered: true, active: state === "running" && pid !== undefined, ...(pid ? { pid } : {}), state };
}

/** Parse a complete decimal PID; partial numbers and unsafe integers are rejected. */
function positive_pid(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/** Query systemd and validate the loaded fragment before accepting its identity. */
async function inspect_systemd(spec: SystemServiceSpec, info: SystemServiceDetails): Promise<SystemServiceStatus> {
  const result = await run_service_command("systemctl", ["--user", "show", info.id, "--no-pager",
    "--property=LoadState,ActiveState,SubState,MainPID,FragmentPath,NeedDaemonReload,DropInPaths,Transient"]);
  const properties = parse_systemd_properties(result.stdout);
  if (properties.get("LoadState") === "not-found" && (result.code === 0 || result.code === 4)
    && !result.stderr.trim() && properties.get("ActiveState") === "inactive") {
    return { registered: false, active: false, state: "not-found" };
  }
  require_service_success(result, "Inspect systemd user service");
  const loaded_path = properties.get("FragmentPath");
  if (loaded_path !== info.startup_path || properties.get("LoadState") !== "loaded"
    || properties.get("NeedDaemonReload") !== "no" || properties.get("DropInPaths") !== ""
    || properties.get("Transient") !== "no") {
    throw new Error(`Refusing an unowned, overridden or stale systemd unit: ${info.id}`);
  }
  const content = await read_definition(loaded_path);
  if (content === undefined || !is_owned_definition(content, spec, info)) throw new Error(`Unverified unit: ${loaded_path}`);
  const state = properties.get("SubState");
  const active_state = properties.get("ActiveState");
  if (!state || !active_state) throw new Error("systemctl show did not report service state");
  const pid = positive_pid(properties.get("MainPID"));
  return { registered: true, active: active_state === "active" && state === "running" && pid !== undefined,
    ...(pid ? { pid } : {}), state: active_state };
}

/** Read manager state with full ownership validation; no writes or daemon-reload. */
export async function inspect_system_service(input: SystemServiceSpec): Promise<SystemServiceStatus> {
  const spec = normalize_spec(input);
  const info = resolve_service_details(spec);
  await validate_definitions(spec, info);
  await validate_manager(info);
  return info.manager === "launchd" ? inspect_launchd(spec, info) : inspect_systemd(spec, info);
}

/** 恢复数据库前只读核对持久停止意图，inactive 或暂时无 PID 本身不足以证明安全。 */
export async function assert_system_service_stopped(input: SystemServiceSpec): Promise<void> {
  const spec = normalize_spec(input);
  const info = resolve_service_details(spec);
  await validate_definitions(spec, info);
  await validate_manager(info);
  if (await read_definition(info.disabled_path) !== `${info.id}\n`) {
    throw new Error("Explicitly stop this Downtown before restoring its database");
  }
  const status = info.manager === "launchd" ? await inspect_launchd(spec, info) : await inspect_systemd(spec, info);
  if (info.manager === "launchd") {
    if (status.registered || await read_definition(info.startup_path) !== undefined) {
      throw new Error("launchd service or login startup remains registered");
    }
  } else {
    if (status.active || status.pid || (status.registered && status.state !== "inactive") || (await default_target_links(info)).length) {
      throw new Error("systemd user service is not persistently stopped");
    }
    const enabled = await run_service_command("systemctl", ["--user", "is-enabled", info.id]);
    if (!(enabled.code === 1 && enabled.stdout.trim() === "disabled" && !enabled.stderr.trim())) {
      throw new Error("systemd user service must be disabled before restoring");
    }
  }
}

/** Collect config/runtime default-target links; never remove links to another unit. */
async function default_target_links(info: SystemServiceDetails): Promise<string[]> {
  const directories = [dirname(info.startup_path)];
  if (process.env.XDG_RUNTIME_DIR) directories.push(join(canonical_path(process.env.XDG_RUNTIME_DIR), "systemd", "user"));
  const links: string[] = [];
  for (const directory of directories) {
    const link_path = join(directory, "default.target.wants", info.id);
    try {
      const stat = await lstat(link_path);
      if (!stat.isSymbolicLink()) throw new Error(`Unowned target entry: ${link_path}`);
      const target_path = resolve(dirname(link_path), await readlink(link_path));
      if (canonical_path(target_path) !== canonical_path(info.startup_path)) throw new Error(`Unowned target link: ${link_path}`);
      links.push(link_path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return links;
}

/** Execute one systemd mutation with the user scope enforced at this boundary. */
async function systemd_command(arguments_list: string[]): Promise<void> {
  require_service_success(await run_service_command("systemctl", ["--user", ...arguments_list]), `systemctl --user ${arguments_list[0]}`);
}

/** Allow the 15s graceful exit plus 5s to settle; each manager command remains bounded to 10s. */
async function wait_for_service_state(spec: SystemServiceSpec, info: SystemServiceDetails,
  target_state: "active" | "stopped", previous_pid?: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  let last_state = "unknown";
  do {
    const status = info.manager === "launchd" ? await inspect_launchd(spec, info) : await inspect_systemd(spec, info);
    const stopped = !status.registered || (info.manager === "systemd" && status.state === "inactive" && !status.pid);
    if (target_state === "active" ? status.active && status.pid !== previous_pid : stopped) return;
    last_state = status.state;
    await new Promise((resolve_wait) => setTimeout(resolve_wait, 100));
  } while (Date.now() < deadline);
  throw new Error(`Service did not become ${target_state}: ${info.id} (${last_state})`);
}

/**
 * Explicitly register and start, restoring login startup only when requested.
 * Existing known jobs may be replaced; unknown labels, paths, overrides or unit
 * fragments fail before mutation. Once mutations begin, failure retains the
 * disabled marker and attempts to remove newly installed startup registration.
 */
export async function start_system_service(input: SystemServiceSpec): Promise<void> {
  const spec = normalize_spec(input);
  const info = resolve_service_details(spec);
  await with_service_lock(spec, async () => {
    await access(spec.node_path, constants.X_OK);
    await access(spec.runner_path, constants.R_OK);
    await access(spec.config_path, constants.R_OK);
    await validate_definitions(spec, info);
    await validate_manager(info, true);
    const previous = info.manager === "launchd" ? await inspect_launchd(spec, info) : await inspect_systemd(spec, info);
    if (info.manager === "systemd") await default_target_links(info);
    await write_definition(info.disabled_path, `${info.id}\n`);
    if (info.manager === "launchd" && previous.registered) {
      require_service_success(await run_service_command("launchctl", ["bootout", info.service_target]), "Unload previous launchd job");
      await wait_for_service_state(spec, info, "stopped");
    }
    await write_definition(info.template_path, render_system_service(spec, info));
    try {
      if (info.manager === "launchd") {
        if (spec.auto_start) await write_definition(info.startup_path, render_system_service(spec, info));
        else await rm(info.startup_path, { force: true });
        require_service_success(await run_service_command("launchctl", ["bootstrap", info.domain, info.definition_path]), "Bootstrap launchd job");
        const loaded = await inspect_launchd(spec, info);
        if (!loaded.registered) throw new Error("launchd bootstrap did not register the job");
        // Bootstrap/KeepAlive may have already started it; avoid killing a healthy runner.
        if (!loaded.active) require_service_success(await run_service_command("launchctl", ["kickstart", info.service_target]), "Kickstart launchd job");
      } else {
        await write_definition(info.startup_path, render_system_service(spec, info));
        await systemd_command(["daemon-reload"]);
        // show loads a newly installed unit before reset-failed requires it to exist.
        const installed = await inspect_systemd(spec, info);
        if (!installed.registered) throw new Error("systemd did not load the installed unit");
        await systemd_command([spec.auto_start ? "enable" : "disable", info.id]);
        if (!spec.auto_start) for (const link_path of await default_target_links(info)) await rm(link_path);
        // Explicit deploy/restart must also recover from a previous native start limit.
        await systemd_command(["reset-failed", info.id]);
        await systemd_command(["restart", "--no-block", info.id]);
      }
      await wait_for_service_state(spec, info, "active", info.manager === "systemd" ? previous.pid : undefined);
      await rm(info.disabled_path, { force: true });
    } catch (error) {
      // Roll back a failed explicit start; preserve both failures if cleanup also fails.
      try { await stop_owned_service(spec, info); } catch (cleanup_error) {
        throw new AggregateError([error, cleanup_error], `Start and cleanup failed for ${info.id}`);
      }
      throw error;
    }
  });
}

/** Persist stop intent before removing auto startup and unloading/stopping the job. */
async function stop_owned_service(spec: SystemServiceSpec, info: SystemServiceDetails): Promise<void> {
  await validate_definitions(spec, info);
  const previous = info.manager === "launchd" ? await inspect_launchd(spec, info) : await inspect_systemd(spec, info);
  const target_links = info.manager === "systemd" ? await default_target_links(info) : [];
  await write_definition(info.disabled_path, `${info.id}\n`);
  if (await read_definition(info.template_path) === undefined) {
    await write_definition(info.template_path, render_system_service(spec, info));
  }
  if (info.manager === "launchd") {
    // Remove login startup first, so even a later bootout failure cannot re-enable it.
    await rm(info.startup_path, { force: true });
    if (previous.registered) require_service_success(await run_service_command("launchctl", ["bootout", info.service_target]), "Stop launchd job");
    await wait_for_service_state(spec, info, "stopped");
  } else {
    // disable does not stop: always issue a separate, explicit stop before reload.
    if (previous.registered) {
      await systemd_command(["disable", info.id]);
      await systemd_command(["stop", "--no-block", info.id]);
    }
    for (const link_path of target_links) await rm(link_path, { force: true });
    await systemd_command(["daemon-reload"]);
    await wait_for_service_state(spec, info, "stopped");
  }
}

/** Stop and disable across future logins/manager restarts until a later explicit start. */
export async function stop_system_service(input: SystemServiceSpec): Promise<void> {
  const spec = normalize_spec(input);
  const info = resolve_service_details(spec);
  await with_service_lock(spec, async () => {
    await validate_definitions(spec, info);
    await validate_manager(info);
    await stop_owned_service(spec, info);
  });
}
