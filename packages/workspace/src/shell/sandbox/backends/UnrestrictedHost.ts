/**
 * unrestricted 宿主进程执行平台后端。
 *
 * 关键点（中文）
 * - 本模块只负责审批通过后的宿主进程启动。
 * - 审批、审计和危险命令判断仍由 ShellApprovalRuntime 负责。
 */

import { spawn } from "node:child_process";
import fs from "fs-extra";
import {
  createPipeProcessHandle,
  spawnPtyProcessHandle,
} from "@/shell/sandbox/ShellProcessHandle.js";
import type {
  SandboxSpawnResult,
  UnrestrictedSpawnRequest,
} from "@/shell/types/Sandbox.js";
import { build_shell_command_invocation } from "@/shell/session/ShellCommandModel.js";

/** 在宿主环境启动已经获得批准的 unrestricted 进程。 */
export async function spawn_unrestricted_host(
  request: UnrestrictedSpawnRequest,
): Promise<SandboxSpawnResult> {
  await fs.ensureDir(request.execution_dir);
  const invocation = build_shell_command_invocation({
    shell_path: request.shell_path,
    cmd: request.cmd,
    login: request.login,
  });
  const child = request.terminal
    ? spawnPtyProcessHandle({
        command: invocation.command,
        args: invocation.args,
        cwd: request.cwd,
        env: request.base_env,
        terminal: { cols: request.cols, rows: request.rows },
      })
    : createPipeProcessHandle(
        spawn(invocation.command, invocation.args, {
          cwd: request.cwd,
          stdio: "pipe",
          env: request.base_env,
        }),
      );
  return {
    child,
    cwd: request.cwd,
    sandboxed: false,
    sandbox_mode: "unrestricted",
    backend: "unrestricted-host",
    network_mode: "full",
    sandbox_dir: "",
    home_dir: String(request.base_env.HOME || ""),
    tmp_dir: String(request.base_env.TMPDIR || "/tmp"),
    cache_dir: String(request.base_env.XDG_CACHE_HOME || ""),
  };
}
