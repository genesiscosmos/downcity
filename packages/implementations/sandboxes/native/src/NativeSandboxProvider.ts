/**
 * Downcity 原生 OS 隔离 Provider。
 *
 * 关键点（中文）
 * - macOS 使用 seatbelt，Linux 使用 bubblewrap；Windows 暂不支持。
 * - `check()` 会实际执行 canary：验证允许写入生效，同时验证越界写入被真正拒绝。
 *   只验证「围栏成立」，不验证工具链完整性。
 * - 宿主进程由 Shell 注入的 launcher 创建，Provider 不持有进程实现。
 */

import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  SandboxProvider,
  SandboxProviderIssue,
  SandboxProviderStatus,
  WorkspaceSandbox,
  WorkspaceSandboxBinding,
} from "@downcity/type/shell";
import { NativeWorkspaceSandbox } from "./NativeWorkspaceSandbox.js";
import { resolve_sandbox_policy } from "./policy/SandboxPolicy.js";
import { resolve_wrapper_binary, wrap_sandbox_invocation } from "./policy/Wrapper.js";
import type { NativeProviderOptions } from "./types/NativeProvider.js";

/** 判断包装器可执行文件是否存在。 */
async function path_exists(target_path: string): Promise<boolean> {
  return await access(target_path).then(() => true).catch(() => false);
}

/** 基于宿主 OS 原生机制的 Workspace Sandbox Provider。 */
export class NativeSandboxProvider implements SandboxProvider {
  /** Provider 稳定后端标识。 */
  readonly backend = "native";

  constructor(private readonly options: NativeProviderOptions = {}) {}

  /** 检查平台、包装器与围栏是否真正可用。 */
  async check(): Promise<SandboxProviderStatus> {
    const binary = resolve_wrapper_binary(process.platform);
    if (!binary) {
      return {
        ok: false,
        backend: this.backend,
        issues: [{
          code: "unsupported_platform",
          message: `Native sandbox does not support ${process.platform}/${process.arch}`,
          fixes: ["Use macOS or Linux, or inject a different sandbox provider instead."],
        }],
      };
    }
    if (!await path_exists(binary)) {
      return {
        ok: false,
        backend: this.backend,
        issues: [{
          code: "wrapper_not_installed",
          message: `${binary} is not available`,
          fixes: process.platform === "linux"
            ? ["Install bubblewrap: `apt-get install bubblewrap` or `dnf install bubblewrap`."]
            : ["Restore /usr/bin/sandbox-exec from the system installation."],
        }],
      };
    }
    const issues = await this.run_canary();
    return { ok: issues.length === 0, backend: this.backend, issues };
  }

  /** 为 Workspace 创建原生隔离环境。 */
  create_workspace(binding: WorkspaceSandboxBinding): WorkspaceSandbox {
    const workspace_id = String(binding.workspace_id || "").trim();
    if (!workspace_id || !binding.workspace_path || !binding.runtime_path) {
      throw new Error(
        "NativeSandboxProvider.create_workspace requires workspace_id, workspace_path and runtime_path",
      );
    }
    const normalized_binding: WorkspaceSandboxBinding = {
      ...binding,
      workspace_id,
      workspace_path: path.resolve(binding.workspace_path),
      runtime_path: path.resolve(binding.runtime_path),
      ...(this.options.network ? { network: binding.network ?? this.options.network } : {}),
    };
    return new NativeWorkspaceSandbox({
      binding: normalized_binding,
      policy: resolve_sandbox_policy({ binding: normalized_binding }),
    });
  }

  /**
   * 实跑一次围栏自检。
   *
   * 关键点（中文）
   * - 只验证「允许的能写、越界的写不了」，不验证工具链完整性。
   * - canary 在临时目录内进行，结束后清理自己的探针文件。
   */
  private async run_canary(): Promise<SandboxProviderIssue[]> {
    const issues: SandboxProviderIssue[] = [];
    const probe_root = await mkdtemp(path.join(os.tmpdir(), "downcity-canary-"));
    const denied_target = path.join(os.homedir(), `.downcity-canary-${process.pid}`);
    const binding: WorkspaceSandboxBinding = {
      workspace_id: "canary",
      workspace_path: probe_root,
      runtime_path: probe_root,
      network: this.options.network ?? "allow",
    };
    const policy = resolve_sandbox_policy({ binding });
    const run = async (cmd: string): Promise<number> => {
      const wrapped = wrap_sandbox_invocation({
        platform: process.platform,
        policy,
        invocation: { command: "/bin/sh", args: ["-c", cmd] },
        env: process.env,
      });
      return await new Promise<number>((resolve) => {
        const child = spawn(wrapped.command, wrapped.args, { stdio: "ignore" });
        child.once("close", (code) => resolve(typeof code === "number" ? code : -1));
        child.once("error", () => resolve(-1));
      });
    };
    try {
      const inside_target = path.join(probe_root, "allowed");
      if (await run(`printf ok > ${JSON.stringify(inside_target)}`) !== 0) {
        issues.push({
          code: "workspace_write_denied",
          message: "Canary could not write inside the Workspace root",
          fixes: ["Check that the Workspace directory is writable by the current user."],
        });
      }
      if (await run(`printf bad > ${JSON.stringify(denied_target)}`) === 0) {
        issues.push({
          code: "denial_not_enforced",
          message: "Canary wrote outside the Workspace, the fence is not effective",
          fixes: ["Reinstall the platform wrapper and rerun the sandbox check."],
        });
      }
    } finally {
      await rm(denied_target, { force: true }).catch(() => undefined);
      await rm(probe_root, { recursive: true, force: true }).catch(() => undefined);
    }
    return issues;
  }
}
