/**
 * Downcity microsandbox Provider。
 *
 * Shell 显式持有此 Provider，并用它为绑定的 Workspace 创建独立、稳定命名且可恢复的
 * microVM 文件系统。microsandbox daemon、镜像缓存等属于外部基础设施，不归 Provider 生命周期所有。
 */

import { createHash } from "node:crypto";
import path from "node:path";
import type {
  SandboxProvider,
  SandboxProviderIssue,
  SandboxProviderStatus,
  WorkspaceSandbox,
  WorkspaceSandboxBinding,
} from "@downcity/type/shell";
import { isInstalled } from "microsandbox";
import { MicrosandboxWorkspace } from "./MicrosandboxWorkspace.js";
import type { MicrosandboxProviderOptions } from "./types/MicrosandboxProvider.js";

const DEFAULT_IMAGE = "node:22-bookworm";
const DEFAULT_CPUS = 2;
const DEFAULT_MEMORY_MIB = 2048;

/** 判断当前操作系统与架构是否由 microsandbox npm 包支持。 */
function is_supported_platform(): boolean {
  if (process.platform === "darwin") return process.arch === "arm64";
  if (process.platform === "linux") return process.arch === "x64" || process.arch === "arm64";
  if (process.platform === "win32") return process.arch === "x64" || process.arch === "arm64";
  return false;
}

/** 归一化正整数资源参数。 */
function resolve_positive_integer(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

/** 生成可读且满足 microsandbox 命名约束的片段。 */
function normalize_name_segment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "workspace";
}

/** 根据 Workspace 身份和 Shell 运行目录生成跨进程稳定名称。 */
function create_sandbox_name(binding: WorkspaceSandboxBinding): string {
  const identity = `${path.resolve(binding.runtime_path)}\0${binding.workspace_id}`;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 20);
  return `downcity-${normalize_name_segment(binding.workspace_id)}-${digest}`;
}

/** 基于 microsandbox 的默认 Workspace Sandbox Provider。 */
export class MicrosandboxProvider implements SandboxProvider {
  /** Provider 稳定后端标识。 */
  readonly backend = "microsandbox";

  /** 新建 Sandbox 使用的 OCI 镜像。 */
  private readonly image: string;

  /** 新建 Sandbox 使用的虚拟 CPU 数量。 */
  private readonly cpus: number;

  /** 新建 Sandbox 使用的内存，单位 MiB。 */
  private readonly memory_mib: number;

  constructor(options: MicrosandboxProviderOptions = {}) {
    this.image = String(options.image || DEFAULT_IMAGE).trim() || DEFAULT_IMAGE;
    this.cpus = resolve_positive_integer(options.cpus, DEFAULT_CPUS);
    this.memory_mib = resolve_positive_integer(options.memory_mib, DEFAULT_MEMORY_MIB);
  }

  /** 检查本机平台与 microsandbox runtime 是否可用。 */
  async check(): Promise<SandboxProviderStatus> {
    const issues: SandboxProviderIssue[] = [];
    if (!is_supported_platform()) {
      issues.push({
        code: "unsupported_platform",
        message: `microsandbox does not support ${process.platform}/${process.arch}`,
        fixes: ["Use a supported macOS ARM64, Linux x64/ARM64, or Windows x64/ARM64 host."],
      });
    } else if (!isInstalled()) {
      issues.push({
        code: "runtime_not_installed",
        message: "microsandbox runtime is not installed or is not runnable",
        fixes: ["Run `npx microsandbox setup` and retry."],
      });
    }
    return {
      ok: issues.length === 0,
      backend: this.backend,
      issues,
    };
  }

  /** 为 Workspace 创建延迟连接的持久 Sandbox。 */
  create_workspace(binding: WorkspaceSandboxBinding): WorkspaceSandbox {
    const workspace_id = String(binding.workspace_id || "").trim();
    const workspace_path = String(binding.workspace_path || "").trim();
    const runtime_path = String(binding.runtime_path || "").trim();
    if (!workspace_id || !workspace_path || !runtime_path) {
      throw new Error(
        "MicrosandboxProvider.create_workspace requires workspace_id, workspace_path and runtime_path",
      );
    }
    const normalized_binding = {
      workspace_id,
      workspace_path: path.resolve(workspace_path),
      runtime_path: path.resolve(runtime_path),
    };
    return new MicrosandboxWorkspace({
      binding: normalized_binding,
      name: create_sandbox_name(normalized_binding),
      image: this.image,
      cpus: this.cpus,
      memory_mib: this.memory_mib,
    });
  }
}
