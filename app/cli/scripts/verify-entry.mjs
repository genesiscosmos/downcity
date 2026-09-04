/**
 * downcity CLI 入口校验脚本。
 *
 * 关键点（中文）
 * - typecheck 阶段不需要重新编译，只确认源码入口存在。
 * - 这个检查保护 `npm i -g downcity` 后能得到 `city` 命令。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const package_root = path.resolve(__dirname, "..");
const entry_path = path.join(package_root, "bin/index.js");

await fs.access(entry_path);
console.log(`[verify-entry] found ${entry_path}`);
