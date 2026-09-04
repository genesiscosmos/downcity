/**
 * @file City 集成测试使用的最小 Sandbox Adapter。
 *
 * 该 Adapter 只验证 Shell core 与 Session 的装配行为，不模拟生产平台的隔离实现。
 */

import { spawn } from "node:child_process";
import {
  build_shell_command_invocation,
  create_pipe_process_handle,
  spawn_pty_process_handle,
} from "../bin/shell/index.js";

/** 当前测试进程共享的最小 Sandbox Adapter。 */
export const test_sandbox = {
    backend: "test-sandbox",
    async preflight() {
      return { ok: true, platform: process.platform, backend: this.backend, issues: [] };
    },
    async resolve_system_read_only_paths() {
      return [];
    },
    async spawn(request) {
      const invocation = build_shell_command_invocation({
        shell_path: request.shell_path,
        cmd: request.cmd,
        login: request.login,
      });
      const env = Object.fromEntries(
        Object.entries(request.base_env).filter(([key, value]) =>
          (request.policy.env_allowlist.includes(key) || key.startsWith("DC_"))
          && typeof value === "string"
          && value.trim().length > 0
        ),
      );
      env.PATH = env.PATH || request.base_env.PATH || "/usr/bin:/bin";
      env.HOME = request.policy.home_dir;
      env.TMPDIR = request.policy.tmp_dir;
      const child = request.terminal
        ? spawn_pty_process_handle({
            command: invocation.command,
            args: invocation.args,
            cwd: request.cwd,
            env,
            terminal: { cols: request.cols, rows: request.rows },
          })
        : create_pipe_process_handle(spawn(invocation.command, invocation.args, {
            cwd: request.cwd,
            env,
            stdio: "pipe",
          }));
      return {
        child,
        cwd: request.cwd,
        sandboxed: true,
        sandbox_mode: "safe",
        backend: this.backend,
        network_mode: request.policy.network_mode,
        sandbox_dir: request.policy.sandbox_dir,
        home_dir: request.policy.home_dir,
        tmp_dir: request.policy.tmp_dir,
        cache_dir: request.policy.cache_dir,
        policy_fingerprint: request.policy.fingerprint,
      };
    },
};

/** 创建当前测试进程共享的最小 Sandbox Adapter。 */
export async function create_platform_sandbox() {
  return test_sandbox;
}
