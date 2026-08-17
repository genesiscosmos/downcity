/**
 * 跨平台 Shell 命令模型。
 *
 * 关键点（中文）
 * - POSIX Shell 使用 `-lc` / `-c`。
 * - Windows 原生命令统一交给 `cmd.exe /d /s /c`，避免 Node 的隐式 `shell: true`。
 * - 本模块只负责命令解释器语义，不承担 Sandbox 权限控制。
 */

import type { ShellCommandInvocation } from "@/shell/types/ShellCommand.js";

/** 解析当前平台的默认 Shell 可执行文件。 */
export function resolve_default_shell_path(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    return String(env.ComSpec || env.COMSPEC || "cmd.exe").trim() || "cmd.exe";
  }
  const env_shell = String(env.SHELL || "").trim();
  if (env_shell) return env_shell;
  return platform === "darwin" ? "/bin/zsh" : "/bin/sh";
}

/** 构造对应平台的 Shell 进程参数。 */
export function build_shell_command_invocation(params: {
  /** Shell 可执行文件路径。 */
  shell_path: string;
  /** 要解释执行的完整命令文本。 */
  cmd: string;
  /** POSIX 平台是否启用 login shell。Windows 会忽略该选项。 */
  login: boolean;
  /** 目标操作系统平台。 */
  platform?: NodeJS.Platform;
}): ShellCommandInvocation {
  const platform = params.platform || process.platform;
  if (platform === "win32") {
    return {
      command: params.shell_path,
      args: ["/d", "/s", "/c", params.cmd],
    };
  }
  return {
    command: params.shell_path,
    args: [params.login ? "-lc" : "-c", params.cmd],
  };
}
