/**
 * Shell Sandbox 统一入口。
 *
 * 关键点（中文）
 * - Shell session 只通过本模块启动进程，不直接依赖具体平台后端。
 * - Safe 模式先解析统一策略，再交给 Seatbelt 或 Bubblewrap。
 * - unrestricted 模式必须由上层完成审批，本模块不重复实现审批状态机。
 */

import type { ShellHostContext } from "@/shell/types/ShellHostContext.js";
import type { SandboxSpawnResult } from "@/shell/types/Sandbox.js";
import {
  resolve_sandbox_cwd,
  resolve_sandbox_policy,
} from "@/shell/sandbox/SandboxPolicy.js";
import { spawn_unrestricted_host } from "@/shell/sandbox/backends/UnrestrictedHost.js";

/**
 * 单次 Shell Sandbox 启动输入。
 */
export interface SandboxStartInput {
  /** 当前 Shell 宿主上下文。 */
  context: ShellHostContext;
  /** 当前执行记录标识。 */
  execution_id: string;
  /** 当前执行记录目录。 */
  execution_dir: string;
  /** 要执行的完整命令。 */
  cmd: string;
  /** 调用方请求的工作目录。 */
  cwd: string;
  /** shell 可执行文件路径。 */
  shell_path: string;
  /** 是否使用 login shell。 */
  login: boolean;
  /** Sandbox 收敛前的基础环境变量。 */
  base_env: NodeJS.ProcessEnv;
  /** 当前执行模式，默认 safe。 */
  sandbox_mode?: "safe" | "unrestricted";
  /** 是否通过 PTY 启动。 */
  terminal?: boolean;
  /** PTY 列数。 */
  cols?: number;
  /** PTY 行数。 */
  rows?: number;
}

/**
 * 在 Safe Sandbox 或已审批的 unrestricted 环境启动进程。
 */
export async function spawn_in_sandbox(
  input: SandboxStartInput,
): Promise<SandboxSpawnResult> {
  if (input.sandbox_mode === "unrestricted") {
    return await spawn_unrestricted_host({
      execution_id: input.execution_id,
      execution_dir: input.execution_dir,
      cmd: input.cmd,
      cwd: input.cwd,
      shell_path: input.shell_path,
      login: input.login,
      base_env: input.base_env,
      terminal: input.terminal,
      cols: input.cols,
      rows: input.rows,
    });
  }

  const policy = await resolve_sandbox_policy(input.context, input.base_env);
  const request = {
    execution_id: input.execution_id,
    execution_dir: input.execution_dir,
    cmd: input.cmd,
    cwd: resolve_sandbox_cwd(input.context, input.cwd),
    shell_path: input.shell_path,
    login: input.login,
    base_env: input.base_env,
    policy,
    terminal: input.terminal,
    cols: input.cols,
    rows: input.rows,
  };
  return await input.context.sandbox.spawn(request);
}

/** Shell session 使用的语义化启动别名。 */
export async function spawn_shell_process(
  input: SandboxStartInput,
): Promise<SandboxSpawnResult> {
  return await spawn_in_sandbox(input);
}

/**
 * 执行一次无需 Shell session 管理的 Safe Sandbox 命令。
 */
export async function run_sandbox_command(
  input: Omit<SandboxStartInput, "sandbox_mode">,
): Promise<{
  /** 合并后的标准输出与标准错误。 */
  stdout: string;
  /** 保留的标准错误字段；当前进程句柄统一合并输出。 */
  stderr: string;
  /** 子进程退出码。 */
  exit_code: number;
  /** Sandbox 启动结果。 */
  spawn: SandboxSpawnResult;
}> {
  const spawn = await spawn_in_sandbox({ ...input, sandbox_mode: "safe" });
  const output_chunks: string[] = [];
  spawn.child.onData((chunk) => {
    output_chunks.push(String(chunk ?? ""));
  });
  const exit_code = await new Promise<number>((resolve, reject) => {
    spawn.child.onError(reject);
    spawn.child.onExit(resolve);
    spawn.child.close_stdin?.();
  });
  const stdout = output_chunks.join("");
  const stderr = "";
  if (exit_code !== 0) {
    throw new Error(stdout.trim() || `Sandbox command failed with exit code ${exit_code}`);
  }
  return { stdout, stderr, exit_code, spawn };
}
