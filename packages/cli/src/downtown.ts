#!/usr/bin/env node

/**
 * downtown / town CLI 共用入口。
 *
 * 关键点（中文）
 * - npm 包运行时不能依赖 `process.argv[1]` 判断命令别名，包管理器 shim 会改写该值。
 * - `downtown` 与 `town` 绑定同一独立入口，部署命令统一分发到 Downtown CLI。
 * - `-v/--version` 保持轻量路径，避免版本查询加载部署或本地状态依赖。
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

const { run_downtown_cli } = await import("@/downtown/index.js");
await run_downtown_cli();
