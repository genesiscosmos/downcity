/**
 * macOS Seatbelt Safe Sandbox 平台后端。
 *
 * 关键点（中文）
 * - 本模块只把已解析策略编译成 Seatbelt profile 并启动子进程。
 * - 只读目录只生成 `file-read*`，写目录额外生成 `file-write*`。
 * - 路径可信性、realpath 与读写重叠校验由 SandboxPolicy 统一完成。
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
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function escape_seatbelt_string(value: string): string {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quote_posix_shell_value(value: string): string {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function build_macos_shell_command(
  request: SandboxSpawnRequest,
  env: NodeJS.ProcessEnv,
): string {
  const path_value = String(env.PATH || "").trim();
  if (!path_value) return request.cmd;
  // 关键点（中文）：login shell 会通过 `/etc/zprofile` 的 path_helper 重排 PATH，必须在其后恢复。
  return `export PATH=${quote_posix_shell_value(path_value)}; ${request.cmd}`;
}

function build_tls_rules(): string[] {
  return [
    `(allow file-read* (literal "/System/Library/Keychains/SystemRootCertificates.keychain"))`,
    `(allow file-read* (literal "/System/Library/Keychains/SystemRootCertificates.keychain-db"))`,
    `(allow file-read* (literal "/Library/Keychains/System.keychain"))`,
    `(allow file-read* (literal "/Library/Keychains/System.keychain-db"))`,
    `(allow file-read* (regex #"^/Users/[^/]+/Library/Keychains/.*"))`,
    `(allow mach-lookup (global-name "com.apple.SecurityServer"))`,
    `(allow mach-lookup (global-name "com.apple.trustd"))`,
  ];
}

/**
 * 将统一 Sandbox 策略编译成 macOS Seatbelt profile。
 */
export function build_macos_seatbelt_profile(
  request: SandboxSpawnRequest,
): string {
  const lines = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow file-read-metadata)",
    "(allow file-ioctl)",
    ...request.policy.read_only_paths.map(
      (value) => `(allow file-read* (subpath "${escape_seatbelt_string(value)}"))`,
    ),
    ...request.policy.read_write_paths.flatMap((value) => [
      `(allow file-read* (subpath "${escape_seatbelt_string(value)}"))`,
      `(allow file-write* (subpath "${escape_seatbelt_string(value)}"))`,
    ]),
    ...build_tls_rules(),
  ];
  if (request.policy.network_mode === "full") {
    lines.push("(allow network-outbound)", "(allow network-inbound)");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * 构造 macOS Safe Sandbox 子进程环境变量。
 */
export function build_macos_sandbox_env(
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
  env.ZDOTDIR = request.policy.home_dir;
  env.TMPDIR = request.policy.tmp_dir;
  env.TMP = request.policy.tmp_dir;
  env.TEMP = request.policy.tmp_dir;
  env.TEMPDIR = request.policy.tmp_dir;
  env.TMPPREFIX = path.join(request.policy.tmp_dir, "zsh");
  env.DC_SANDBOX = "1";
  env.DC_SANDBOX_DIR = request.policy.sandbox_dir;
  env.DC_SANDBOX_HOME = request.policy.home_dir;
  env.DC_SANDBOX_TMP = request.policy.tmp_dir;
  env.DC_SANDBOX_CACHE = request.policy.cache_dir;
  env.SHELL = request.shell_path;
  const xcode_contents_path = request.policy.read_only_paths.find((value) =>
    value.endsWith(`${path.sep}Contents`) &&
    fs.existsSync(path.join(value, "Developer"))
  );
  if (xcode_contents_path) {
    const developer_path = String(
      env.DEVELOPER_DIR || path.join(xcode_contents_path, "Developer"),
    );
    const developer_bin_path = path.join(developer_path, "usr", "bin");
    // 关键点（中文）
    // - `/usr/bin/git` 是 xcrun 入口，会尝试在真实用户临时目录写 lookup cache。
    // - 优先使用 Xcode 内真实工具目录，既消除警告，也不需要开放项目外写权限。
    env.DEVELOPER_DIR = developer_path;
    env.PATH = [
      developer_bin_path,
      ...String(env.PATH || "")
        .split(path.delimiter)
        .filter((value) => value && value !== developer_bin_path),
    ]
      .join(path.delimiter);
  }
  return env;
}

/**
 * 在 macOS Seatbelt Safe Sandbox 中启动子进程。
 */
export async function spawn_macos_seatbelt(
  request: SandboxSpawnRequest,
): Promise<SandboxSpawnResult> {
  await fs.ensureDir(request.policy.sandbox_dir);
  await fs.ensureDir(request.policy.tmp_dir);
  await fs.ensureDir(request.policy.cache_dir);
  await fs.ensureDir(request.execution_dir);
  await fs.ensureDir(path.join(request.policy.sandbox_dir, "Library", "Caches"));

  const profile_path = path.join(request.execution_dir, "sandbox-profile.sb");
  await fs.writeFile(
    profile_path,
    build_macos_seatbelt_profile(request),
    "utf-8",
  );
  const env = build_macos_sandbox_env(request);
  const invocation = build_shell_command_invocation({
    shell_path: request.shell_path,
    cmd: build_macos_shell_command(request, env),
    login: request.login,
    platform: "darwin",
  });
  const args = [
    "-f",
    profile_path,
    invocation.command,
    ...invocation.args,
  ];
  const child = request.terminal
    ? spawnPtyProcessHandle({
        command: "/usr/bin/sandbox-exec",
        args,
        cwd: request.cwd,
        env,
        terminal: { cols: request.cols, rows: request.rows },
      })
    : createPipeProcessHandle(
        spawn("/usr/bin/sandbox-exec", args, {
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
    backend: "macos-seatbelt",
    network_mode: request.policy.network_mode,
    sandbox_dir: request.policy.sandbox_dir,
    home_dir: request.policy.home_dir,
    tmp_dir: request.policy.tmp_dir,
    cache_dir: request.policy.cache_dir,
    policy_fingerprint: request.policy.fingerprint,
  };
}
