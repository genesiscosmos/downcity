/**
 * Shell 执行目标统一入口。
 *
 * 关键点（中文）
 * - 默认命令直接进入当前 Workspace 独享的持久 Sandbox。
 * - host 目标必须由上层先完成审批，本模块只负责启动已经获批的宿主进程。
 * - Sandbox 内只存在固定的 Workspace 挂载，不再编译宿主路径权限列表。
 */

import type {
  ShellProcessResult,
  ShellExecutionTarget,
  ShellHostContext,
} from "@downcity/type/shell";
import { spawn_host_process } from "@/shell/sandbox/backends/Host.js";
import { resolve_sandbox_cwd } from "@/shell/session/ShellRuntimeEnvironment.js";

/** 单次 Shell 进程启动输入。 */
export interface ShellProcessStartInput {
  /** 当前 Shell 宿主上下文。 */
  context: ShellHostContext;
  /** 当前 Shell Session 标识。 */
  execution_id: string;
  /** 当前执行记录目录。 */
  execution_dir: string;
  /** 要执行的完整命令。 */
  cmd: string;
  /** 调用方请求的工作目录。 */
  cwd: string;
  /** 当前执行使用的 Shell 路径。 */
  shell_path: string;
  /** 是否使用 login shell。 */
  login: boolean;
  /** 当前目标可见的环境变量。 */
  env: NodeJS.ProcessEnv;
  /** 当前明确执行目标。 */
  target?: ShellExecutionTarget;
  /** 是否通过 PTY 启动。 */
  terminal?: boolean;
  /** PTY 列数。 */
  cols?: number;
  /** PTY 行数。 */
  rows?: number;
}

/** 在 Workspace Sandbox 或已审批的宿主环境启动进程。 */
export async function spawn_shell_process(
  input: ShellProcessStartInput,
): Promise<ShellProcessResult> {
  if (input.target === "host") {
    return await spawn_host_process({
      execution_id: input.execution_id,
      execution_dir: input.execution_dir,
      cmd: input.cmd,
      cwd: input.cwd,
      shell_path: input.shell_path,
      login: input.login,
      env: input.env,
      terminal: input.terminal,
      cols: input.cols,
      rows: input.rows,
    });
  }

  return await input.context.sandbox.spawn({
    execution_id: input.execution_id,
    cmd: input.cmd,
    cwd: resolve_sandbox_cwd(input.context, input.cwd),
    shell_path: input.shell_path,
    login: input.login,
    env: Object.fromEntries(
      Object.entries(input.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    terminal: input.terminal,
    cols: input.cols,
    rows: input.rows,
  });
}

/** 执行一次不进入 Shell Session 管理的 Sandbox 命令。 */
export async function run_sandbox_command(
  input: Omit<ShellProcessStartInput, "target">,
): Promise<{
  /** 合并后的标准输出与标准错误。 */
  stdout: string;
  /** 保留的标准错误字段；当前进程句柄统一合并输出。 */
  stderr: string;
  /** 子进程退出码。 */
  exit_code: number;
  /** Sandbox 启动结果。 */
  spawn: ShellProcessResult;
}> {
  const spawn = await spawn_shell_process({ ...input, target: "sandbox" });
  const output_chunks: string[] = [];
  spawn.child.on_data((chunk) => output_chunks.push(String(chunk ?? "")));
  const exit_code = await new Promise<number>((resolve, reject) => {
    spawn.child.on_error(reject);
    spawn.child.on_exit(resolve);
    spawn.child.close_stdin?.();
  });
  const stdout = output_chunks.join("");
  if (exit_code !== 0) {
    throw new Error(stdout.trim() || `Sandbox command failed with exit code ${exit_code}`);
  }
  return { stdout, stderr: "", exit_code, spawn };
}
