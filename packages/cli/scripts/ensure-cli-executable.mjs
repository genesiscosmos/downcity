/**
 * downcity CLI 构建后入口权限修复脚本。
 *
 * 关键点（中文）
 * - CLI 包暴露 City 与 Federation 两类 bin 入口。
 * - 构建阶段显式补齐可执行权限，避免发布或全局安装后入口不可运行。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const package_root = path.resolve(__dirname, "..");
const cli_entry_paths = [
  path.join(package_root, "bin/downcity.js"),
  path.join(package_root, "bin/downfed.js"),
];

for (const cli_entry_path of cli_entry_paths) {
  const stats = await fs.stat(cli_entry_path);
  await fs.chmod(cli_entry_path, stats.mode | 0o755);
  console.log(`[ensure-cli-executable] chmod +x ${cli_entry_path}`);
}
