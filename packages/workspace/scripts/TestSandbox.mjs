/**
 * @file Shell core 测试使用的最小 Sandbox Adapter。
 *
 * 关键点（中文）：只验证 core/session 行为，不冒充任何生产平台隔离实现。
 */

import { spawn } from "node:child_process";
import {
  createPipeProcessHandle,
  spawnPtyProcessHandle,
} from "../bin/shell/sandbox/ShellProcessHandle.js";
import { build_shell_command_invocation } from "../bin/shell/session/ShellCommandModel.js";

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
    const child = request.terminal
      ? spawnPtyProcessHandle({
          command: invocation.command,
          args: invocation.args,
          cwd: request.cwd,
          env: request.base_env,
          terminal: { cols: request.cols, rows: request.rows },
        })
      : createPipeProcessHandle(spawn(invocation.command, invocation.args, {
          cwd: request.cwd,
          env: request.base_env,
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
