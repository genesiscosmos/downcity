/**
 * Windows SRT 受限进程启动实现。
 *
 * 关键点（中文）：宿主始终使用 shell=false 启动 srt-win，真正的 cmd/PowerShell 只在 sandbox 用户下运行。
 */

import { spawn } from "node:child_process";
import fs from "fs-extra";
import {
  createPipeProcessHandle,
  spawnPtyProcessHandle,
} from "@downcity/workspace/shell/sandbox/ShellProcessHandle.js";
import type {
  SandboxSpawnRequest,
  SandboxSpawnResult,
  ShellProcessHandle,
} from "@downcity/workspace/shell/types/Sandbox.js";
import { WINDOWS_SRT_BACKEND } from "./WindowsSrtConstants.js";
import { acquire_windows_srt_runtime } from "./WindowsSrtRuntime.js";
import type { WindowsSrtSandboxOptions } from "./types/WindowsSrt.js";

/** 在 Anthropic SRT Windows 安全域中启动单个 Shell 进程。 */
export async function spawn_windows_srt(
  owner: symbol,
  request: SandboxSpawnRequest,
  options: WindowsSrtSandboxOptions,
): Promise<SandboxSpawnResult> {
  await Promise.all([
    fs.ensureDir(request.policy.sandbox_dir),
    fs.ensureDir(request.policy.home_dir),
    fs.ensureDir(request.policy.tmp_dir),
    fs.ensureDir(request.policy.cache_dir),
    fs.ensureDir(request.execution_dir),
  ]);

  const descriptor = await acquire_windows_srt_runtime(owner, request, options);
  let child: ShellProcessHandle;
  try {
    child = request.terminal
      ? spawnPtyProcessHandle({
          command: descriptor.argv[0],
          args: descriptor.argv.slice(1),
          cwd: request.cwd,
          env: descriptor.env,
          terminal: { cols: request.cols, rows: request.rows },
        })
      : createPipeProcessHandle(spawn(
          descriptor.argv[0],
          descriptor.argv.slice(1),
          {
            cwd: request.cwd,
            env: descriptor.env,
            shell: false,
            windowsHide: true,
            stdio: "pipe",
          },
        ));
  } catch (error) {
    descriptor.release();
    throw error;
  }

  child.onExit(descriptor.release);
  child.onError(descriptor.release);
  return {
    child,
    cwd: request.cwd,
    sandboxed: true,
    sandbox_mode: "safe",
    backend: WINDOWS_SRT_BACKEND,
    network_mode: request.policy.network_mode,
    sandbox_dir: request.policy.sandbox_dir,
    home_dir: request.policy.home_dir,
    tmp_dir: request.policy.tmp_dir,
    cache_dir: request.policy.cache_dir,
    policy_fingerprint: request.policy.fingerprint,
  };
}
