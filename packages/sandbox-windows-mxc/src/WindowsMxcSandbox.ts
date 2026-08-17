/**
 * Microsoft MXC Windows Development Sandbox Adapter。
 *
 * 关键点（中文）：MXC 依赖和 Windows 宿主逻辑完全收敛在实验平台包内。
 */

import { access } from "node:fs/promises";
import path from "node:path";
import fs from "fs-extra";
import type {
  SandboxPreflightResult, SandboxSpawnRequest, SandboxSpawnResult,
  ShellSandboxAdapter, ShellSandboxHostInput,
} from "@downcity/workspace/protocol";
import type { WindowsMxcSupport } from "./types/WindowsMxc.js";
import { read_windows_env_value } from "./WindowsEnvironment.js";
import { inspect_windows_mxc_support } from "./WindowsMxcSupport.js";
import { spawn_windows_mxc } from "./WindowsMxc.js";

function dedupe_paths(values: string[]): string[] {
  const result = new Map<string, string>();
  for (const value of values) {
    const normalized = path.resolve(String(value || "").trim());
    if (normalized) result.set(normalized.toLowerCase(), normalized);
  }
  return [...result.values()].sort((left, right) => left.localeCompare(right));
}

async function command_exists(command: string): Promise<boolean> {
  const path_value = String(read_windows_env_value(process.env, "PATH") || "");
  for (const directory of path_value.split(path.delimiter)) {
    const candidate = path.join(directory.replace(/^"|"$/gu, ""), command);
    if (await access(candidate).then(() => true).catch(() => false)) return true;
  }
  return false;
}

/** Microsoft MXC Windows 实验平台 adapter。 */
export class WindowsMxcSandbox implements ShellSandboxAdapter {
  /** 当前实现的稳定后端标识。 */
  readonly backend = "windows-mxc-dev";

  /** 检查 Windows 版本、cmd.exe 与 MXC runtime。 */
  async preflight(): Promise<SandboxPreflightResult> {
    const issues: SandboxPreflightResult["issues"] = [];
    if (process.platform !== "win32") {
      issues.push({ code: "unsupported-platform", message: "Microsoft MXC sandbox requires a win32 host.", fixes: ["Use @downcity/sandbox-windows-mxc only on Windows."] });
    } else {
      if (!(await command_exists("cmd.exe"))) {
        issues.push({ code: "missing-command", message: "Windows MXC development sandbox requires cmd.exe.", fixes: ["Restore cmd.exe to the Windows system PATH."] });
      }
      const support = await Promise.resolve(inspect_windows_mxc_support()).catch((error: unknown) => ({
        supported: false, windows_build: null, warnings: [],
        reason: error instanceof Error ? error.message : String(error),
      } satisfies WindowsMxcSupport));
      if (!support.supported) {
        const unsupported_version = support.windows_build !== null && support.windows_build < 26_100;
        issues.push({
          code: unsupported_version ? "unsupported-windows-version" : "sandbox-runtime-unavailable",
          message: support.reason || "Microsoft MXC Windows sandbox is unavailable.",
          fixes: unsupported_version
            ? ["Upgrade the host to Windows 11 24H2 build 26100 or newer."]
            : ["Reinstall @downcity/sandbox-windows-mxc and run the MXC platform probe."],
        });
      }
    }
    return { ok: issues.length === 0, platform: process.platform, backend: this.backend, issues };
  }

  /** 解析 PATH、Node 和 cmd.exe 所在的 Windows 系统只读目录。 */
  async resolve_system_read_only_paths(input: ShellSandboxHostInput): Promise<string[]> {
    const path_entries = String(read_windows_env_value(input.base_env, "PATH") || "")
      .split(path.delimiter)
      .map((value) => value.trim().replace(/^"|"$/gu, ""))
      .filter((value) => path.isAbsolute(value) && fs.existsSync(value));
    const comspec = String(read_windows_env_value(input.base_env, "COMSPEC") || "").trim();
    return dedupe_paths([
      ...path_entries,
      path.dirname(process.execPath),
      ...(path.isAbsolute(comspec) ? [path.dirname(comspec)] : []),
    ]);
  }

  /** 使用 Microsoft MXC 启动受限进程。 */
  async spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult> {
    return await spawn_windows_mxc(request);
  }
}
