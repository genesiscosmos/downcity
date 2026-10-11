#!/usr/bin/env node

/**
 * Local Federation 受管进程启动器。
 *
 * 关键说明（中文）
 * - 启动器命令行显式携带 fed_id 与 instance_id，停止时可校验 PID 是否仍属于目标实例。
 * - 实际项目命令作为同一进程组的子进程运行，CLI 可以统一终止 shell 及其后代。
 * - stdout / stderr 继承启动器文件描述符，最终统一进入系统级 Federation 日志。
 */

import { spawn } from "node:child_process";

/** 启动器参数。 */
interface LocalLauncherArguments {
  /** 被管理的 Fed ID。 */
  fed_id: string;
  /** 本次本地部署唯一 instance ID。 */
  instance_id: string;
  /** 项目根目录。 */
  project_dir: string;
  /** 实际启动 shell 命令。 */
  command: string;
}

const args = parse_arguments(process.argv.slice(2));
const child = spawn(args.command, {
  cwd: args.project_dir,
  env: process.env,
  shell: true,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    if (process.platform === "win32") {
      process.exitCode = 1;
      return;
    }
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

/** 解析并校验内部启动参数。 */
function parse_arguments(argv: string[]): LocalLauncherArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Invalid LocalProcessLauncher arguments.");
    }
    values.set(key.slice(2), value);
  }
  const fed_id = values.get("fed-id")?.trim() ?? "";
  const instance_id = values.get("instance-id")?.trim() ?? "";
  const project_dir = values.get("project-dir")?.trim() ?? "";
  const command = values.get("command")?.trim() ?? "";
  if (!fed_id || !instance_id || !project_dir || !command) {
    throw new Error("LocalProcessLauncher requires fed-id, instance-id, project-dir and command.");
  }
  return { fed_id, instance_id, project_dir, command };
}
