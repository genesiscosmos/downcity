#!/usr/bin/env node

/**
 * downcity / city CLI 入口。
 *
 * 关键点（中文）
 * - npm、pnpm、yarn 生成的 bin shim 可能会把 `process.argv[1]` 指向真实 JS 文件。
 * - 因此 City 与 Federation 使用独立入口文件，不再依赖 shim 名称做运行时分发。
 * - `-v/--version` 保持轻量路径，避免版本查询加载本地 SQLite 等运行时依赖。
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

const { runDowncityCli } = await import("@/city/index.js");
await runDowncityCli();
