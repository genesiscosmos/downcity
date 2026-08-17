/**
 * Anthropic Sandbox Runtime Windows adapter。
 *
 * 关键点（中文）：平台依赖、UAC 安装状态与全局 SRT 生命周期完全收敛在独立 package 内。
 */

import path from "node:path";
import type {
  SandboxPreflightResult,
  SandboxSpawnRequest,
  SandboxSpawnResult,
  ShellSandboxAdapter,
  ShellSandboxHostInput,
} from "@downcity/workspace/protocol";
import { WINDOWS_SRT_BACKEND } from "./WindowsSrtConstants.js";
import { spawn_windows_srt } from "./WindowsSrtProcess.js";
import { dispose_windows_srt_runtime } from "./WindowsSrtRuntime.js";
import { inspect_windows_srt_support } from "./WindowsSrtSupport.js";
import type { WindowsSrtSandboxOptions } from "./types/WindowsSrt.js";

function dedupe_paths(values: string[]): string[] {
  const result = new Map<string, string>();
  for (const value of values) {
    const normalized = path.resolve(String(value || "").trim());
    if (normalized) result.set(normalized.toLowerCase(), normalized);
  }
  return [...result.values()].sort((left, right) => left.localeCompare(right));
}

/** Anthropic SRT 原生 Windows Alpha adapter。 */
export class WindowsSrtSandbox implements ShellSandboxAdapter {
  /** 当前实现的稳定后端标识。 */
  readonly backend = WINDOWS_SRT_BACKEND;
  /** 当前 adapter 的进程级 SRT 所有者标识。 */
  private readonly owner = Symbol("windows-srt-owner");

  constructor(private readonly options: WindowsSrtSandboxOptions = {}) {}

  /** 检查 helper、Downcity sandbox 用户与 WFP filter。 */
  async preflight(): Promise<SandboxPreflightResult> {
    return await inspect_windows_srt_support(this.options);
  }

  /** 返回 Windows 系统工具、Node 和 PATH 工具需要读取的目录。 */
  async resolve_system_read_only_paths(
    input: ShellSandboxHostInput,
  ): Promise<string[]> {
    const path_entries = String(input.base_env.PATH || input.base_env.Path || "")
      .split(path.delimiter)
      .map((value) => value.replace(/^"|"$/gu, "").trim())
      .filter(Boolean);
    const system_root = String(
      input.base_env.SystemRoot || input.base_env.WINDIR || "C:\\Windows",
    ).trim();
    return dedupe_paths([
      system_root,
      path.dirname(process.execPath),
      ...path_entries,
    ]);
  }

  /** 使用 Anthropic SRT 启动受限 Windows 进程。 */
  async spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult> {
    return await spawn_windows_srt(this.owner, request, this.options);
  }

  /** 清理当前 adapter 持有的 SRT 代理与临时 ACL。 */
  async dispose(): Promise<void> {
    await dispose_windows_srt_runtime(this.owner);
  }
}
