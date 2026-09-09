#!/usr/bin/env node

/**
 * 构建 macOS arm64 发布应用。
 *
 * 该阶段只负责生成并验证已签名的 Downcity.app；Apple 公证和安装包封装由
 * 根目录 release 脚本在后续阶段完成，保证失败后可以从检查点继续。
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath as file_url_to_path } from "node:url";

const script_directory = dirname(file_url_to_path(import.meta.url));
const desktop_directory = resolve(script_directory, "..");
const root_directory = resolve(desktop_directory, "../..");
const app_output_directory = resolve(desktop_directory, "dist", "mac-arm64");

function run(command, args, options = {}) {
  return new Promise((resolve_run, reject_run) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject_run);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve_run();
        return;
      }
      reject_run(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
        ),
      );
    });
  });
}

await run("pnpm", ["run", "build:icon"], { cwd: desktop_directory });
await run("pnpm", ["run", "build:desktop"], { cwd: root_directory });

console.log(`Removing stale macOS app output: ${app_output_directory}`);
await rm(app_output_directory, { recursive: true, force: true });

await run(
  "pnpm",
  [
    "exec",
    "electron-builder",
    "--config",
    "electron-builder.mac.yml",
    "--mac",
    "dir",
    "--arm64",
  ],
  { cwd: desktop_directory, env: process.env },
);

await run("codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  resolve(app_output_directory, "Downcity.app"),
]);
