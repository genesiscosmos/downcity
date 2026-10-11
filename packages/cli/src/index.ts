#!/usr/bin/env node

/**
 * Downcity CLI 统一入口。
 *
 * 关键点（中文）
 * - 本包同时提供 `downfed` 与 `downcity`（别名 `city`）两个全局命令。
 * - 根据执行时的命令名分发到对应的 commander 根命令。
 * - `-v/--version` 走轻量快速路径。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCliLocale, setCliLocale } from "@/shared/CliLocale.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const argv = process.argv.slice(2);

setCliLocale(resolveCliLocale({ argv }));

if (argv.length === 1 && (argv[0] === "-v" || argv[0] === "--version")) {
  const package_json = JSON.parse(
    readFileSync(join(__dirname, "../package.json"), "utf-8"),
  ) as { version?: string };
  console.log(String(package_json.version || "unknown"));
  process.exit(0);
}

const invoked = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "downcity";

if (invoked === "downfed" || invoked === "fed") {
  const { runDownfedCli } = await import("@/federation/index.js");
  await runDownfedCli();
} else {
  const { runDowncityCli } = await import("@/city/index.js");
  await runDowncityCli();
}
