/** Workspace 可选 Shell 能力协议。 */

import type { Tool } from "ai";
import type { SandboxSpawnResult } from "@/shell/types/Sandbox.js";

/** Workspace Shell 执行一次受控命令的输入。 */
export interface WorkspaceShellSafeCommandInput {
  /** 当前命令执行记录的稳定标识。 */
  execution_id: string;

  /** 当前命令执行记录使用的私有目录。 */
  execution_dir: string;

  /** 要交给解释器执行的完整命令。 */
  cmd: string;

  /** 当前命令使用的 Workspace 工作目录。 */
  cwd: string;

  /** 当前命令使用的解释器绝对路径。 */
  shell_path: string;

  /** 是否使用 login shell 语义。 */
  login: boolean;

  /** Sandbox 收敛前的基础环境变量。 */
  base_env: NodeJS.ProcessEnv;

  /** 是否通过 PTY 启动命令。 */
  terminal?: boolean;

  /** PTY 列数。 */
  cols?: number;

  /** PTY 行数。 */
  rows?: number;
}

/** Workspace Shell 执行一次受控命令的结果。 */
export interface WorkspaceShellSafeCommandResult {
  /** 命令的标准输出。 */
  stdout: string;

  /** 命令的标准错误输出。 */
  stderr: string;

  /** 命令最终退出码。 */
  exit_code: number;

  /** 平台 Sandbox 返回的完整启动信息。 */
  spawn: SandboxSpawnResult;
}

/** 由 Workspace 持有并绑定到项目边界的命令执行能力。 */
export interface WorkspaceShell {
  /** 当前 Shell 向 Agent 暴露的命令与进程工具。 */
  readonly tools: Record<string, Tool>;

  /** 将 Shell 绑定到一个 Workspace 项目和私有数据作用域。 */
  bind(input: {
    /** 项目文件和命令 cwd 的根路径。 */
    root_path: string;
    /** AgentWorkspace 私有数据根路径。 */
    data_path: string;
  }): void;

  /** 更新后续进程使用的 Workspace 环境变量。 */
  set_env(env: Readonly<Record<string, string>>): void;

  /** 在当前 Workspace 的 Safe Sandbox 中执行一次命令。 */
  run_safe_command(
    input: WorkspaceShellSafeCommandInput,
  ): Promise<WorkspaceShellSafeCommandResult>;

  /** 释放当前 Shell 的进程、PTY 与 Sandbox 资源。 */
  dispose(): Promise<void>;
}
