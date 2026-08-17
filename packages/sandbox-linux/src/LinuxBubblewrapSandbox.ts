/**
 * Linux Bubblewrap Sandbox Adapter。
 *
 * 关键点（中文）：本模块只负责 Linux 宿主探测、系统目录和 Bubblewrap 启动。
 */

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  SandboxPreflightResult, SandboxSpawnRequest, SandboxSpawnResult,
  ShellSandboxAdapter, ShellSandboxHostInput,
} from "@downcity/workspace/protocol";
import { spawn_linux_bubblewrap } from "./LinuxBubblewrap.js";

const SYSTEM_READ_ONLY_PATHS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"];

async function command_exists(command: string, base_env: NodeJS.ProcessEnv): Promise<boolean> {
  for (const directory of String(base_env.PATH || "").split(path.delimiter)) {
    if (await access(path.join(directory, command)).then(() => true).catch(() => false)) return true;
  }
  return false;
}

async function read_proc_int(file_path: string): Promise<number | null> {
  const raw = await readFile(file_path, "utf8").catch(() => "");
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

/** Linux Bubblewrap 平台 adapter。 */
export class LinuxBubblewrapSandbox implements ShellSandboxAdapter {
  /** 当前实现的稳定后端标识。 */
  readonly backend = "linux-bubblewrap";

  /** 检查 bwrap 与 user namespace 是否可用。 */
  async preflight(): Promise<SandboxPreflightResult> {
    const issues: SandboxPreflightResult["issues"] = [];
    if (process.platform !== "linux") {
      issues.push({ code: "unsupported-platform", message: "Linux Bubblewrap sandbox requires a linux host.", fixes: ["Use @downcity/sandbox-linux only on Linux."] });
    } else {
      if (!(await command_exists("bwrap", process.env))) {
        issues.push({ code: "missing-command", message: "Linux shell sandbox requires bubblewrap (bwrap).", fixes: ["Debian / Ubuntu: sudo apt install bubblewrap", "Fedora: sudo dnf install bubblewrap", "Arch: sudo pacman -S bubblewrap"] });
      }
      const clone_enabled = await read_proc_int("/proc/sys/kernel/unprivileged_userns_clone");
      const max_namespaces = await read_proc_int("/proc/sys/user/max_user_namespaces");
      if (clone_enabled === 0 || max_namespaces === 0) {
        issues.push({ code: "userns-disabled", message: "Linux user namespaces are disabled, so bubblewrap cannot create the sandbox.", fixes: ["Enable unprivileged user namespaces on the host."] });
      }
    }
    return { ok: issues.length === 0, platform: process.platform, backend: this.backend, issues };
  }

  /** 返回 Linux 命令运行所需的系统只读目录。 */
  async resolve_system_read_only_paths(_input: ShellSandboxHostInput): Promise<string[]> {
    return [...SYSTEM_READ_ONLY_PATHS];
  }

  /** 使用 Bubblewrap 启动受限进程。 */
  async spawn(request: SandboxSpawnRequest): Promise<SandboxSpawnResult> {
    return await spawn_linux_bubblewrap(request);
  }
}
