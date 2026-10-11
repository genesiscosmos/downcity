/**
 * downcity CLI 构建产物路径别名重写脚本。
 *
 * 关键点（中文）
 * - TypeScript `paths` 只服务编译期，npm 包运行时必须使用相对路径。
 * - 这里只重写 CLI 包内部的 `@/...`，保留 `@downcity/*` 等真实 npm 包导入。
 * - 输出路径按当前文件目录到 `bin` 根目录下目标文件的相对关系计算。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const package_root = path.resolve(__dirname, "..");
const bin_root = path.join(package_root, "bin");
const alias_literal_pattern = /(["'])@\/([^"']+)\1/g;

function should_check_file(file_name) {
  return file_name.endsWith(".js") || file_name.endsWith(".d.ts");
}

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

function to_posix_path(value) {
  return value.split(path.sep).join("/");
}

function build_relative_specifier(file_path, alias_target) {
  const target_path = path.join(bin_root, alias_target);
  const relative_path = to_posix_path(path.relative(path.dirname(file_path), target_path));

  if (relative_path.startsWith(".")) return relative_path;
  return `./${relative_path}`;
}

let rewritten_count = 0;

for (const file_path of await collect_files(bin_root)) {
  const content = await fs.readFile(file_path, "utf-8");
  const rewritten = content.replace(alias_literal_pattern, (literal, quote, alias_target) => {
    rewritten_count += 1;
    return `${quote}${build_relative_specifier(file_path, alias_target)}${quote}`;
  });

  if (rewritten !== content) {
    await fs.writeFile(file_path, rewritten, "utf-8");
  }
}

console.log(`[rewrite-build-aliases] rewrote ${rewritten_count} @/ imports`);
