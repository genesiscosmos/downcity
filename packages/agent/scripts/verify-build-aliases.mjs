/**
 * 校验 Agent 发布产物没有遗留 TypeScript 路径别名。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bin_root = path.resolve(__dirname, "../bin");
const alias_pattern = /(?:from\s+["'](?:@\/|@executor\/)|import\s*\(\s*["'](?:@\/|@executor\/)|["'](?:@\/|@executor\/))/;

async function collect_files(dir_path) {
  const entries = await fs.readdir(dir_path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entry_path = path.join(dir_path, entry.name);
    if (entry.isDirectory()) files.push(...await collect_files(entry_path));
    else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) files.push(entry_path);
  }
  return files;
}

const failed_files = [];
for (const file_path of await collect_files(bin_root)) {
  if (alias_pattern.test(await fs.readFile(file_path, "utf-8"))) failed_files.push(file_path);
}
if (failed_files.length > 0) {
  console.error("[agent-build] unresolved @/ imports:");
  for (const file_path of failed_files) console.error(`- ${file_path}`);
  process.exit(1);
}
