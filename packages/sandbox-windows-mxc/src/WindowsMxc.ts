/**
 * Microsoft MXC Windows Development Sandbox 平台后端。
 *
 * 关键点（中文）
 * - Downcity 只维护统一策略到 MXC config 的薄适配，不再维护 Win32 broker。
 * - MXC 负责 AppContainer、Job Object、PTY、ACL 生命周期与隔离层级探测。
 * - 当前后端仅支持 Windows 11 24H2+，属于 Development / unstable。
 * - MXC 不可用时直接拒绝启动，不会退化为 unrestricted 宿主执行。
 */

import path from "node:path";
import fs from "fs-extra";
import {
  createConfigFromPolicy,
  spawnSandboxFromConfig,
  type ContainerConfig,
  type SandboxPolicy as MxcSandboxPolicy,
} from "@microsoft/mxc-sdk";
import {
  createPipeProcessHandle,
  createPtyProcessHandle,
} from "@downcity/workspace/shell/sandbox/ShellProcessHandle.js";
import { inspect_windows_mxc_support } from "@/WindowsMxcSupport.js";
import { read_windows_env_value } from "@/WindowsEnvironment.js";
import { build_windows_cmd_command_line } from "@/WindowsMxcCommandLine.js";
import type {
  SandboxSpawnRequest,
  SandboxSpawnResult,
} from "@downcity/workspace/shell/types/Sandbox.js";

/** 构造 Windows Safe Sandbox 子进程环境变量。 */
export function build_windows_mxc_env(
  request: SandboxSpawnRequest,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const copied_env_keys = new Set<string>();
  for (const key of request.policy.env_allowlist) {
    const normalized_key = key.toLowerCase();
    if (copied_env_keys.has(normalized_key)) continue;
    const value = read_windows_env_value(request.base_env, key);
    if (typeof value !== "string" || !value.trim()) continue;
    env[key] = value;
    copied_env_keys.add(normalized_key);
  }
  for (const [key, value] of Object.entries(request.base_env)) {
    if (!key.startsWith("DC_")) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    env[key] = value;
  }
  const system_root = String(
    read_windows_env_value(request.base_env, "SystemRoot")
    || read_windows_env_value(request.base_env, "WINDIR")
    || "C:\\Windows",
  ).trim();
  const comspec = String(
    read_windows_env_value(request.base_env, "ComSpec")
    || path.win32.join(system_root, "System32", "cmd.exe"),
  ).trim();
  env.ComSpec = comspec;
  env.COMSPEC = comspec;
  env.HOME = request.policy.home_dir;
  env.USERPROFILE = request.policy.home_dir;
  env.TMP = request.policy.tmp_dir;
  env.TEMP = request.policy.tmp_dir;
  env.LOCALAPPDATA = request.policy.cache_dir;
  env.DC_SANDBOX = "1";
  env.DC_SANDBOX_DEVELOPMENT = "1";
  env.DC_SANDBOX_DIR = request.policy.sandbox_dir;
  env.DC_SANDBOX_HOME = request.policy.home_dir;
  env.DC_SANDBOX_TMP = request.policy.tmp_dir;
  env.DC_SANDBOX_CACHE = request.policy.cache_dir;
  env.SHELL = request.shell_path;
  return env;
}

/** 把 Downcity 解析后的策略映射为 MXC 0.7 runtime 使用的 alpha policy schema。 */
export function build_windows_mxc_policy(
  request: SandboxSpawnRequest,
): MxcSandboxPolicy {
  return {
    version: "0.7.0-alpha",
    filesystem: {
      readonlyPaths: request.policy.read_only_paths,
      readwritePaths: request.policy.read_write_paths,
      clearPolicyOnExit: true,
    },
    network: {
      allowOutbound: request.policy.network_mode === "full",
      allowLocalNetwork: request.policy.network_mode === "full",
    },
    ui: {
      allowWindows: true,
      clipboard: "none",
      allowInputInjection: false,
    },
  };
}

/** 构造可直接交给 MXC runtime 的 Windows process config。 */
export function build_windows_mxc_config(
  request: SandboxSpawnRequest,
): ContainerConfig {
  const config = createConfigFromPolicy(
    build_windows_mxc_policy(request),
    "process",
  );
  if (!config.process) {
    throw new Error("Microsoft MXC did not create a process configuration.");
  }
  config.process.commandLine = build_windows_cmd_command_line(
    request.shell_path,
    request.cmd,
  );
  config.process.cwd = request.cwd;
  return config;
}

/** 在 Windows MXC Development Sandbox 中启动 cmd 命令。 */
export async function spawn_windows_mxc(
  request: SandboxSpawnRequest,
): Promise<SandboxSpawnResult> {
  const support = inspect_windows_mxc_support();
  if (!support.supported) {
    throw new Error(support.reason || "Microsoft MXC Windows sandbox is unavailable.");
  }

  await fs.ensureDir(request.policy.sandbox_dir);
  await fs.ensureDir(request.policy.tmp_dir);
  await fs.ensureDir(request.policy.cache_dir);
  await fs.ensureDir(request.execution_dir);

  const config = build_windows_mxc_config(request);

  const env = build_windows_mxc_env(request);
  const child = request.terminal
    ? createPtyProcessHandle(spawnSandboxFromConfig(config, {
        ptyOptions: {
          cols: request.cols || 120,
          rows: request.rows || 40,
        },
      }, request.cwd, env))
    : createPipeProcessHandle(spawnSandboxFromConfig(config, {
        usePty: false,
      }, request.cwd, env));

  return {
    child,
    cwd: request.cwd,
    sandboxed: true,
    sandbox_mode: "safe",
    backend: "windows-mxc-dev",
    network_mode: request.policy.network_mode,
    sandbox_dir: request.policy.sandbox_dir,
    home_dir: request.policy.home_dir,
    tmp_dir: request.policy.tmp_dir,
    cache_dir: request.policy.cache_dir,
    policy_fingerprint: request.policy.fingerprint,
  };
}
