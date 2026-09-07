/**
 * 已审批宿主进程执行后端。
 *
 * 关键点（中文）：本模块不实现部分宿主权限；调用到这里意味着宿主已经明确批准完整 host 执行。
 */

import { spawn } from "node:child_process";
import fs from "fs-extra";
import type { ShellProcessResult } from "@downcity/type/shell";
import {
  create_pipe_process_handle,
  spawn_pty_process_handle,
} from "@/shell/sandbox/ShellProcessHandle.js";
import { build_shell_command_invocation } from "@/shell/session/ShellCommandModel.js";

/** 已审批宿主进程的启动参数。 */
export interface HostProcessRequest {
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
  await fs.ensureDir(request.execution_dir);
  const invocation = build_shell_command_invocation({
    shell_path: request.shell_path,
    cmd: request.cmd,
    login: request.login,
  });
  const child = request.terminal
    ? spawn_pty_process_handle({
        command: invocation.command,
        args: invocation.args,
        cwd: request.cwd,
        env: request.env,
        terminal: { cols: request.cols, rows: request.rows },
      })
    : create_pipe_process_handle(
        spawn(invocation.command, invocation.args, {
          cwd: request.cwd,
          stdio: "pipe",
          env: request.env,
        }),
      );
  return {
    child,
    cwd: request.cwd,
    backend: "host",
  };
}
