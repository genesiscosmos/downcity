/**
 * 依赖内容随快照固定；恢复时重新编译浏览器代码前核对实际文件。
 * pnpm 内部链接可跟随，循环引用只记录其根内目标；根外链接拒绝。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/** 稳定遍历依赖树，不把文件时间当成执行完整性。 */
export async function hash_extension_dependencies(source_path: string): Promise<string> {
  const root = await fs.realpath(source_path);
  const hash = createHash("sha256");
  const visited = new Set<string>();
  async function visit(relative: string): Promise<void> {
    const filename = path.join(root, relative);
    const actual = await fs.realpath(filename);
    if (!actual.startsWith(`${root}${path.sep}`)) throw new Error("Dependency symlink points outside the snapshot");
    const stats = await fs.stat(actual);
    if (stats.isDirectory()) {
      hash.update(`${relative}\0${path.relative(root, actual)}\0`);
      if (visited.has(actual)) return;
      visited.add(actual);
      for (const name of (await fs.readdir(actual)).sort()) await visit(path.join(relative, name));
    } else if (stats.isFile()) {
      hash.update(relative.split(path.sep).join("/")); hash.update("\0"); hash.update(await fs.readFile(actual)); hash.update("\0");
    } else throw new Error("Unsupported dependency file");
  }
  const exists = await fs.lstat(path.join(root, "node_modules")).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
  if (exists) await visit("node_modules");
  return hash.digest("hex");
}
