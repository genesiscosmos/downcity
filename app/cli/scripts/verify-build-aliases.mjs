/**
 * downcity CLI 构建产物路径别名校验脚本。
 *
 * 关键点（中文）
 * - npm 包运行时没有 TypeScript path alias 支持，`bin` 产物必须只使用 Node 可解析路径。
 * - 构建阶段直接扫描 JS 与声明文件，避免把 `@/...` 残留发布到 npm。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const package_root = path.resolve(__dirname, "..");
const bin_root = path.join(package_root, "bin");
const alias_pattern = /(?:from\s+["']@\/|import\s*\(\s*["']@\/|["']@\/)/;
function should_check_file(file_name) {
  return file_name.endsWith(".js") || file_name.endsWith(".d.ts");
}

const failed_files = [];

async function collect_files(dir_path) {
  const entries = await fs.readdir(dir_path, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entry_path = path.join(dir_path, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collect_files(entry_path));
      continue;
    }

    if (entry.isFile() && should_check_file(entry.name)) {
      files.push(entry_path);
    }
  }

  return files;
}

for (const file_path of await collect_files(bin_root)) {
  const content = await fs.readFile(file_path, "utf-8");
  if (alias_pattern.test(content)) {
    failed_files.push(path.relative(package_root, file_path));
  }
}

if (failed_files.length > 0) {
  console.error("[verify-build-aliases] found unresolved @/ imports in build output:");
  for (const file_path of failed_files.slice(0, 40)) {
    console.error(`- ${file_path}`);
  }
  if (failed_files.length > 40) {
    console.error(`- ...and ${failed_files.length - 40} more files`);
  }
  process.exit(1);
}

console.log("[verify-build-aliases] no unresolved @/ imports found");
