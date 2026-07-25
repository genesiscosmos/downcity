/**
 * 祖先目录文件收集工具模块。
 *
 * 职责说明（中文）
 * - 负责沿着目录树自下而上查找固定文件名，并按“根到叶子”顺序返回。
 * - 供配置继承、工作区约定查找等场景复用，避免把目录遍历逻辑散落到业务模块。
 * - 这里只处理文件路径收集，不解析文件内容。
 */

import fs from "fs-extra";
import path from "node:path";

/**
 * 收集当前目录及其所有祖先目录中的指定文件。
 *
 * 关键点（中文）
 * - 返回结果按“最上层目录 -> 当前项目目录”排序，适合做逐层覆盖合并。
 * - 若文件名为空，则直接返回空数组，避免调用方拼接出异常路径。
 */
export function collect_ancestor_named_file_paths(
  project_root: string,
  filename: string,
): string[] {
  const normalizedFilename = String(filename || "").trim();
  if (!normalizedFilename) return [];

  const paths: string[] = [];
  let dir = path.resolve(String(project_root || "").trim() || ".");
  while (true) {
    const candidate = path.join(dir, normalizedFilename);
    if (fs.existsSync(candidate)) {
      paths.push(candidate);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return paths.reverse();
}
