/**
 * Downcity 原生 OS 隔离 Provider。
 *
 * 关键点（中文）
 * - macOS 使用 seatbelt，Linux 使用 bubblewrap；Windows 暂不支持。
 * - `check()` 实跑文件权限、子进程继承与 TCP loopback 隔离探针。
 * - 自检异常返回不可用状态，不以启动失败冒充隔离成功，也不自动降级为宿主执行。
 * - 宿主进程由 Shell 注入的 launcher 创建，Provider 不持有进程实现。
 */

import { access } from "node:fs/promises";
import path from "node:path";
import type {
  SandboxProvider,
  SandboxProviderStatus,
  WorkspaceSandbox,
  WorkspaceSandboxBinding,
} from "@downcity/type/shell";
import { NativeWorkspaceSandbox } from "./NativeWorkspaceSandbox.js";
import { resolve_sandbox_policy } from "./policy/SandboxPolicy.js";
import { resolve_wrapper_binary } from "./policy/Wrapper.js";
import { run_sandbox_canary } from "./doctor/SandboxCanary.js";
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
    try {
      const issues = await run_sandbox_canary(this.options.network ?? "allow");
      return { ok: issues.length === 0, backend: this.backend, issues };
    } catch (error) {
      return {
        ok: false,
        backend: this.backend,
        issues: [{
          code: "canary_failed",
          message: `Sandbox self-check could not complete: ${error instanceof Error ? error.message : String(error)}`,
          fixes: ["Check temporary directory access and the native sandbox wrapper."],
        }],
      };
    }
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
      allowed_credential_env: [...(this.options.allowed_credential_env ?? [])],
    });
  }
}
