#!/usr/bin/env node
/**
 * Windows SRT 显式安装管理命令。
 *
 * 关键点（中文）：setup/remove 是唯一允许触发 UAC 的入口，普通 sandbox spawn 永不自动提权。
 */

import {
  install_windows_srt,
  uninstall_windows_srt,
} from "./WindowsSrtSupport.js";

async function main(): Promise<void> {
  const command = String(process.argv[2] || "").trim().toLowerCase();
  if (process.platform !== "win32") {
    throw new Error("Windows SRT setup can only run on Windows.");
  }
  if (command === "setup") {
    const result = await install_windows_srt({
      force: process.argv.includes("--force"),
    });
    if (result.cancelled) {
      process.exitCode = 2;
      console.error("Windows SRT setup was cancelled at the UAC prompt.");
      return;
    }
    console.log("Downcity Windows SRT sandbox installed.");
    return;
  }
  if (command === "remove") {
    const result = uninstall_windows_srt();
    if (result.cancelled) {
      process.exitCode = 2;
      console.error("Windows SRT removal was cancelled at the UAC prompt.");
      return;
    }
    console.log("Downcity Windows SRT sandbox removed.");
    return;
  }
  console.error(
    "Usage: downcity-sandbox-windows-srt <setup [--force] | remove>",
  );
  process.exitCode = 1;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
