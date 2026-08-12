/**
 * City CLI 入口路径解析。
 *
 * 关键点（中文）
 * - City 管理 CLI 不能再内置 City 命令源码。
 * - 当控制面需要操作 CLI City daemon 时，应调用同一个 downcity 安装包里的 `city` 入口。
 * - 本模块只解析本机入口路径，不承担 City 命令实现。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 解析当前安装环境中的 `city` CLI 入口。
 */
export function resolveCityCliPath(): string {
  const candidates = [
    process.env.DOWNCITY_CITY_CLI_PATH,
    // downcity 发布包：city runtime 被复制到 `<pkg>/city`，city wrapper 位于 `<pkg>/bin/city`。
    path.resolve(__dirname, "../../bin/city/index.js"),
    // workspace 开发态：city 构建产物在 `cli/city/bin/index.js`。
    path.resolve(__dirname, "../../../runtime/bin/index.js"),
    path.resolve(process.cwd(), "cli/city/bin/index.js"),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const matched = candidates.find((candidate) => fs.existsSync(candidate));
  if (matched) return matched;

  throw new Error(
    [
      "city CLI entry not found.",
      "Run `pnpm -C cli/city build`, or set DOWNCITY_CITY_CLI_PATH.",
    ].join(" "),
  );
}
