/**
 * 已审批宿主进程执行后端。
 *
 * 关键点（中文）
 * - 本模块不实现部分宿主权限；调用到这里意味着宿主已经明确批准完整 host 执行。
 * - 进程创建统一交给 SandboxProcessLauncher，与原生隔离共用同一份进程语义。
 */

import type { SandboxProcessLauncher, ShellProcessResult } from "@downcity/type/shell";
import { build_shell_command_invocation } from "@/shell/session/ShellCommandModel.js";

/** 已审批宿主进程的启动参数。 */
export interface HostProcessRequest {
  /** 宿主提供的进程启动器。 */
  launcher: SandboxProcessLauncher;
  /** 当前 Shell Session 标识。 */
  execution_id: string;
  /** 当前执行记录目录。 */
  execution_dir: string;
  /** 要执行的完整命令。 */
  cmd: string;
  /** 宿主工作目录。 */
  cwd: string;
  /** 宿主 Shell 路径。 */
  shell_path: string;
  /** 是否使用 login shell。 */
  login: boolean;
  /** 宿主进程环境变量。 */
  env: NodeJS.ProcessEnv;
  /** 是否通过 PTY 启动。 */
  terminal?: boolean;
  /** PTY 列数。 */
  cols?: number;
  /** PTY 行数。 */
  rows?: number;
}

/** 在宿主环境启动一个已经通过审批的进程。 */
export async function spawn_host_process(
  request: HostProcessRequest,
): Promise<ShellProcessResult> {
  const invocation = build_shell_command_invocation({
    shell_path: request.shell_path,
    cmd: request.cmd,
    login: request.login,
  });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.env)) {
    if (typeof value === "string") env[key] = value;
  }
  const child = await request.launcher.launch({
    command: invocation.command,
    args: invocation.args,
    cwd: request.cwd,
    env,
    execution_dir: request.execution_dir,
    terminal: request.terminal,
    cols: request.cols,
    rows: request.rows,
  });
  return {
    child,
    cwd: request.cwd,
    backend: "host",
  };
}
