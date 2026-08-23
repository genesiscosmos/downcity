/**
 * Agent 构建产物路径别名重写。
 *
 * TypeScript 的 `paths` 仅服务编译期；发布到 Node 运行时的 `bin` 产物
 * 必须改成相对路径。只处理 Agent 包自己的 `@/` 别名，不触碰真实包名。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const package_root = path.resolve(__dirname, "..");
const bin_root = path.join(package_root, "bin");
const alias_literal_pattern = /(["'])(@\/|@executor\/)([^"']+)\1/g;

async function collect_files(dir_path) {
  const entries = await fs.readdir(dir_path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entry_path = path.join(dir_path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collect_files(entry_path));
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
      files.push(entry_path);
    }
  }
  return files;
}

function to_posix_path(value) {
  return value.split(path.sep).join("/");
}

let rewritten_count = 0;
for (const file_path of await collect_files(bin_root)) {
  const content = await fs.readFile(file_path, "utf-8");
  const rewritten = content.replace(alias_literal_pattern, (literal, quote, alias_prefix, alias_target) => {
    rewritten_count += 1;
    const target_root = alias_prefix === "@executor/" ? path.join(bin_root, "executor") : bin_root;
    const target_path = path.join(target_root, alias_target);
    const relative_path = to_posix_path(path.relative(path.dirname(file_path), target_path));
    const specifier = relative_path.startsWith(".") ? relative_path : `./${relative_path}`;
    return `${quote}${specifier}${quote}`;
  });
  if (rewritten !== content) await fs.writeFile(file_path, rewritten, "utf-8");
}

console.log(`[agent-build] rewrote ${String(rewritten_count)} @/ imports`);
