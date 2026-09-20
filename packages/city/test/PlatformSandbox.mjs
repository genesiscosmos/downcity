/**
 * @file City 与 Shell 集成测试使用的内存 Sandbox Provider。
 *
 * 该实现只模拟 Provider、Workspace Sandbox 与 guest 路径映射协议；进程仍在测试
 * 宿主启动，因此不能作为生产隔离实现。
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  build_shell_command_invocation,
  create_pipe_process_handle,
  spawn_pty_process_handle,
} from "../bin/shell/index.js";

const guest_workspace_path = "/workspace";

/** 把 guest Workspace cwd 映射回测试宿主目录。 */
function resolve_host_cwd(workspace_path, guest_cwd) {
  const normalized = path.posix.resolve(guest_cwd);
  if (
    normalized !== guest_workspace_path
    && !normalized.startsWith(`${guest_workspace_path}/`)
  ) {
    throw new Error(`Test Sandbox cwd escapes Workspace: ${guest_cwd}`);
  }
  const relative = path.posix.relative(guest_workspace_path, normalized);
  return relative
    ? path.join(workspace_path, ...relative.split("/"))
    : workspace_path;
}

/** 创建测试 Workspace Sandbox。 */
export function create_test_workspace_sandbox(binding, backend = "test-sandbox") {
  const workspace_path = path.resolve(binding.workspace_path);
  const sandbox_id = `test:${binding.workspace_id}`;
  let stopped = false;
  return {
    id: sandbox_id,
    backend,
    workspace_path: guest_workspace_path,
    get stopped() {
      return stopped;
    },
    describe() {
      return {
        backend,
        sandbox_id,
        workdir: guest_workspace_path,
        mounts: [
          { host_path: workspace_path, sandbox_path: guest_workspace_path, mode: "rw" },
        ],
        network: binding.network ?? "allow",
        read_scope: "mounts",
        writable_roots: [workspace_path],
        denied_read_paths: [],
        policy_digest: `test:${binding.workspace_id}`,
        persistent: true,
      };
    },
    async spawn(request) {
      stopped = false;
      const cwd = resolve_host_cwd(workspace_path, request.cwd);
      const home_path = path.join(binding.runtime_path, "sandbox-home");
      await fs.mkdir(home_path, { recursive: true });
      const invocation = build_shell_command_invocation({
        shell_path: request.shell_path,
        cmd: request.cmd,
        login: request.login,
      });
      const env = {
        PATH: process.env.PATH || "/usr/bin:/bin",
        HOME: home_path,
        TMPDIR: path.join(home_path, "tmp"),
        ...request.env,
      };
      await fs.mkdir(env.TMPDIR, { recursive: true });
      const child = request.terminal
        ? spawn_pty_process_handle({
            command: invocation.command,
            args: invocation.args,
            cwd,
            env,
            terminal: { cols: request.cols, rows: request.rows },
          })
        : create_pipe_process_handle(spawn(invocation.command, invocation.args, {
            cwd,
            env,
            stdio: "pipe",
          }));
      return {
        child,
        cwd: request.cwd,
        sandbox_id,
        backend,
      };
    },
    async stop() {
      stopped = true;
    },
    async reset() {
      await fs.rm(path.join(binding.runtime_path, "sandbox-home"), {
        recursive: true,
        force: true,
      });
      stopped = true;
    },
  };
}

/** 创建可记录 Workspace Sandbox 的测试 Provider。 */
export function create_test_sandbox_provider() {
  const workspaces = new Map();
  return {
    backend: "test-sandbox",
    workspaces,
    async check() {
      return { ok: true, backend: this.backend, issues: [] };
    },
    create_workspace(binding) {
      const sandbox = create_test_workspace_sandbox(binding, this.backend);
      workspaces.set(binding.workspace_id, sandbox);
      return sandbox;
    },
  };
}
