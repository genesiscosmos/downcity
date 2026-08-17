/**
 * macOS Seatbelt Sandbox Adapter。
 *
 * 关键点（中文）：平台探测和系统目录解析留在本包，Shell 核心只消费统一契约。
 */

import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import type {
  SandboxPreflightResult,
  SandboxSpawnRequest,
  SandboxSpawnResult,
  ShellSandboxAdapter,
  ShellSandboxHostInput,
} from "@downcity/workspace/protocol";
import { spawn_macos_seatbelt } from "./MacOsSeatbelt.js";

const exec_file = promisify(execFile);
const SYSTEM_READ_ONLY_PATHS = [
  "/bin", "/usr", "/System", "/etc", "/private/etc", "/dev",
  "/Library", "/opt/homebrew", "/usr/local",
];

async function resolve_macos_developer_path(
  base_env: NodeJS.ProcessEnv,
): Promise<string | null> {
  let developer_path = String(base_env.DEVELOPER_DIR || "").trim();
  if (!developer_path) {
    const result = await exec_file("/usr/bin/xcode-select", ["-p"], {
      timeout: 5_000,
      encoding: "utf8",
    }).catch(() => null);
    developer_path = String(result?.stdout || "").trim();
  }
  if (!developer_path) return null;
  const real_path = await fs.realpath(developer_path).catch(() => "");
  if (!real_path || !(await fs.stat(real_path).catch(() => null))?.isDirectory()) return null;
  const xcode_suffix = `${path.sep}Contents${path.sep}Developer`;
  return real_path.endsWith(xcode_suffix) ? path.dirname(real_path) : real_path;
}

/** macOS Seatbelt 平台 adapter。 */
export class MacOsSeatbeltSandbox implements ShellSandboxAdapter {
  /** 当前实现的稳定后端标识。 */
  readonly backend = "macos-seatbelt";

  /** 检查 Seatbelt 命令是否可用。 */
  async preflight(): Promise<SandboxPreflightResult> {
    const command_available = await access("/usr/bin/sandbox-exec")
      .then(() => true)
      .catch(() => false);
    const runtime_available = command_available && await exec_file(
      "/usr/bin/sandbox-exec",
      ["-p", "(version 1) (allow default)", "/usr/bin/true"],
      { timeout: 5_000 },
    ).then(() => true).catch(() => false);
    return {
      ok: process.platform === "darwin" && runtime_available,
      platform: process.platform,
      backend: this.backend,
      issues: process.platform !== "darwin"
        ? [{ code: "unsupported-platform", message: "macOS Seatbelt sandbox requires a darwin host.", fixes: ["Use @downcity/sandbox-macos only on macOS."] }]
        : !command_available
          ? [{ code: "missing-command", message: "macOS shell sandbox requires /usr/bin/sandbox-exec.", fixes: ["Use a macOS system that includes sandbox-exec."] }]
          : runtime_available
            ? []
            : [{ code: "sandbox-runtime-unavailable", message: "macOS sandbox-exec exists but cannot apply a Seatbelt profile.", fixes: ["Run Downcity from a host process that permits Seatbelt sandbox creation."] }],
    };
  }

  /** 解析 macOS 系统工具和当前 Xcode 所需的只读目录。 */
  async resolve_system_read_only_paths(input: ShellSandboxHostInput): Promise<string[]> {
    const developer_path = await resolve_macos_developer_path(input.base_env);
    return [...SYSTEM_READ_ONLY_PATHS, ...(developer_path ? [developer_path] : [])];
  }

  /** 使用 Seatbelt 启动受限进程。 */
  async spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult> {
    return await spawn_macos_seatbelt(request);
  }
}
