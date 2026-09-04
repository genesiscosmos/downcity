/**
 * Linux Bubblewrap Safe Sandbox 平台后端。
 *
 * 关键点（中文）
 * - 已解析策略中的只读目录映射为 `--ro-bind`，写目录映射为 `--bind`。
 * - 本模块不管理 Shell session，也不接受模型直接提供的权限路径。
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import {
  createPipeProcessHandle,
  spawnPtyProcessHandle,
} from "@downcity/workspace/shell/sandbox/ShellProcessHandle.js";
import type {
  SandboxSpawnRequest,
  SandboxSpawnResult,
} from "@downcity/workspace/shell/types/Sandbox.js";
import { build_shell_command_invocation } from "@downcity/workspace/shell/session/ShellCommandModel.js";

const DEFAULT_PATH_VALUE =
  "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin";

function is_path_covered(paths: string[], target_path: string): boolean {
  const normalized_target = path.resolve(target_path);
  return paths.some((value) => {
    const normalized_value = path.resolve(value);
    if (normalized_value === normalized_target) return true;
    const relative = path.relative(normalized_value, normalized_target);
    return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

function add_parent_dirs(
  args: string[],
  target_path: string,
  created_dirs: Set<string>,
): void {
  const parts = path.resolve(target_path).split(path.sep).filter(Boolean);
  let current = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = `${current}/${parts[index]}`;
    if (created_dirs.has(current)) continue;
    created_dirs.add(current);
    args.push("--dir", current);
  }
}

/**
 * 将统一 Sandbox 策略编译成 Bubblewrap 参数。
 */
export function build_linux_bubblewrap_args(
  request: SandboxSpawnRequest,
): string[] {
  const invocation = build_shell_command_invocation({
    shell_path: request.shell_path,
    cmd: request.cmd,
    login: request.login,
    platform: "linux",
  });
  const created_dirs = new Set<string>();
  const mounted_paths: string[] = [];
  const args = [
    "--die-with-parent",
    "--unshare-pid",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
  ];
  if (request.policy.network_mode === "off") args.push("--unshare-net");

  for (const read_only_path of request.policy.read_only_paths) {
    if (!fs.existsSync(read_only_path)) continue;
    if (!is_path_covered(mounted_paths, read_only_path)) {
      add_parent_dirs(args, read_only_path, created_dirs);
    }
    args.push("--ro-bind", read_only_path, read_only_path);
    mounted_paths.push(read_only_path);
  }
  for (const read_write_path of request.policy.read_write_paths) {
    if (!is_path_covered(mounted_paths, read_write_path)) {
      add_parent_dirs(args, read_write_path, created_dirs);
    }
    args.push("--bind", read_write_path, read_write_path);
    mounted_paths.push(read_write_path);
  }
  args.push(
    "--chdir",
    request.cwd,
    invocation.command,
    ...invocation.args,
  );
  return args;
}

/**
 * 构造 Linux Safe Sandbox 子进程环境变量。
 */
export function build_linux_sandbox_env(
  request: SandboxSpawnRequest,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of request.policy.env_allowlist) {
    const value = request.base_env[key];
    if (typeof value !== "string" || !value.trim()) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(request.base_env)) {
    if (!key.startsWith("DC_")) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    env[key] = value;
  }
  env.PATH = String(env.PATH || request.base_env.PATH || DEFAULT_PATH_VALUE);
  env.HOME = request.policy.home_dir;
  env.TMPDIR = request.policy.tmp_dir;
  env.TMP = request.policy.tmp_dir;
  env.TEMP = request.policy.tmp_dir;
  env.TEMPDIR = request.policy.tmp_dir;
  env.TMPPREFIX = path.join(request.policy.tmp_dir, "zsh");
  env.XDG_CACHE_HOME = request.policy.cache_dir;
  env.DC_SANDBOX = "1";
  env.DC_SANDBOX_DIR = request.policy.sandbox_dir;
  env.DC_SANDBOX_HOME = request.policy.home_dir;
  env.DC_SANDBOX_TMP = request.policy.tmp_dir;
  env.DC_SANDBOX_CACHE = request.policy.cache_dir;
  env.SHELL = request.shell_path;
  return env;
}

/**
 * 在 Linux Bubblewrap Safe Sandbox 中启动子进程。
 */
export async function spawn_linux_bubblewrap(
  request: SandboxSpawnRequest,
): Promise<SandboxSpawnResult> {
  await fs.ensureDir(request.policy.sandbox_dir);
  await fs.ensureDir(request.policy.tmp_dir);
  await fs.ensureDir(request.policy.cache_dir);
  await fs.ensureDir(request.execution_dir);
  for (const read_write_path of request.policy.read_write_paths) {
    await fs.ensureDir(read_write_path);
  }
  const args = build_linux_bubblewrap_args(request);
  const env = build_linux_sandbox_env(request);
  const child = request.terminal
    ? spawnPtyProcessHandle({
        command: "bwrap",
        args,
        cwd: request.cwd,
        env,
        terminal: { cols: request.cols, rows: request.rows },
      })
    : createPipeProcessHandle(
        spawn("bwrap", args, {
          cwd: request.cwd,
          stdio: "pipe",
          env,
        }),
      );
  return {
    child,
    cwd: request.cwd,
    sandboxed: true,
    sandbox_mode: "safe",
    backend: "linux-bubblewrap",
    network_mode: request.policy.network_mode,
    sandbox_dir: request.policy.sandbox_dir,
    home_dir: request.policy.home_dir,
    tmp_dir: request.policy.tmp_dir,
    cache_dir: request.policy.cache_dir,
    policy_fingerprint: request.policy.fingerprint,
  };
}
