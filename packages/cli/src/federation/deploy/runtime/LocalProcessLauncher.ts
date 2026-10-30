#!/usr/bin/env node

/**
 * Local Federation 受管进程启动器。
 *
 * 关键说明（中文）
 * - 启动器命令行显式携带 fed_id 与 instance_id，停止时可校验 PID 是否仍属于目标实例。
 * - Node 直接执行已安装产物入口，子进程属于同一进程组，不读取源码或运行 shell。
 * - stdout / stderr 继承启动器文件描述符，最终统一进入系统级 Federation 日志。
 */

import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/** 启动器参数。 */
interface LocalLauncherArguments {
  /** 被管理的 Fed ID。 */
  fed_id: string;
  /** 本次本地部署唯一 instance ID。 */
  instance_id: string;
  /** 独立安装的 release 根目录。 */
  release_dir: string;
  /** release 内相对的 JavaScript 入口。 */
  entry: string;
}

const args = parse_arguments(process.argv.slice(2));
const child = spawn(process.execPath, [resolve(args.release_dir, args.entry)], {
  cwd: dirname(resolve(args.release_dir, args.entry)),
  env: process.env,
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
  const release_dir = values.get("release-dir")?.trim() ?? "";
  const entry = values.get("entry")?.trim() ?? "";
  const entry_relative = relative(resolve(release_dir), resolve(release_dir, entry));
  if (!fed_id || !instance_id || !isAbsolute(release_dir) || !entry || isAbsolute(entry)
    || entry_relative === ".." || entry_relative.startsWith("../") || entry_relative.startsWith("..\\")) {
    throw new Error("LocalProcessLauncher requires a release directory and an entry inside it.");
  }
  return { fed_id, instance_id, release_dir, entry };
}
