/**
 * 宿主进程启动器。
 *
 * 关键点（中文）
 * - 复用现有 pipe / PTY 句柄实现，隔离 Provider 只提供已经包装完成的命令。
 * - 原生隔离与已审批的 host 执行共用同一份进程语义，避免两处 spawn 逻辑漂移。
 * - 进程句柄的所有权仍在 Shell Session 一侧，启动器只负责创建进程。
 */

import { spawn } from "node:child_process";
import fs from "fs-extra";
import type {
  SandboxLaunchRequest,
  SandboxProcessLauncher,
} from "@downcity/type/shell";
import {
  create_pipe_process_handle,
  spawn_pty_process_handle,
} from "@/shell/sandbox/ShellProcessHandle.js";

/** 创建使用宿主 Node 能力的进程启动器。 */
export function create_sandbox_process_launcher(): SandboxProcessLauncher {
  return {
    async launch(request: SandboxLaunchRequest) {
      await fs.ensureDir(request.execution_dir);
      if (request.terminal) {
        return spawn_pty_process_handle({
          command: request.command,
          args: [...request.args],
          cwd: request.cwd,
          env: { ...request.env },
          terminal: { cols: request.cols, rows: request.rows },
        });
      }
      return create_pipe_process_handle(
        spawn(request.command, [...request.args], {
          cwd: request.cwd,
          stdio: "pipe",
          env: { ...request.env },
        }),
      );
    },
  };
}
