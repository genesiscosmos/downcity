/**
 * @file 校验 homepage 文档中引用的 Downcity package、子路径与导出符号真实存在。
 *
 * 关键点（中文）
 * - 文档里的 import 示例没有任何自动校验，包改名、子路径调整或符号改名后只能靠人读文档发现。
 * - 本脚本以 workspace manifest 与声明文件为唯一事实源，校验两件事：
 *   1. 正文与代码块里的 `@downcity/<name>` 与 `@downcity/<name>/<subpath>` 是否存在；
 *   2. `import { ... } from "@downcity/<name>"` 里的符号是否真的由该包导出。
 * - 分两级报告：确定的问题记为 error；无法判定的事实（workspace 里没有的包）记为 warning。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspace_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content_root = path.join(workspace_root, "homepage", "content");
const scoped_prefix = "@downcity/";

/** workspace 中被发现但允许无 exports 子路径的包不需要特殊处理，统一按 exports 判定。 */
const default_export_key = ".";

/**
 * 收集一个声明文件导出的符号名；`export * from` 只展开一层。
 *
 * @param {string} file_path 声明文件绝对路径。
 * @param {Set<string>} visited 已展开文件，避免循环。
 * @returns {Set<string>} 符号名集合。
 */
function read_declaration_exports(file_path, visited = new Set()) {
  const symbols = new Set();
  if (visited.has(file_path)) return symbols;
  visited.add(file_path);

  let text;
  try {
    text = readFileSync(file_path, "utf8");
  } catch {
    return symbols;
  }

  for (const match of text.matchAll(/export (?:type )?\{([^}]*)\}/g)) {
    for (const piece of match[1].split(",")) {
      const name = piece.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z0-9_]+$/.test(name)) symbols.add(name);
    }
  }
  for (const match of text.matchAll(/export (?:declare )?(?:const|function|class|abstract class)\s+([A-Za-z0-9_]+)/g)) {
    symbols.add(match[1]);
  }
  for (const match of text.matchAll(/export \* from "([^"]+)"/g)) {
    const target = path.join(path.dirname(file_path), match[1].replace(/\.js$/, ".d.ts"));
    for (const name of read_declaration_exports(target, visited)) symbols.add(name);
  }
  return symbols;
}

/**
 * 读取 workspace 中全部 `@downcity/*` package 的 exports 键。
 *
 * @returns {Map<string, { manifest_path: string; export_keys: Set<string>; has_exports: boolean }>}
 */
export function read_workspace_package_exports() {
  const packages = new Map();
  const manifests = find_package_manifests(path.join(workspace_root, "packages"));
  manifests.push("app/cli/package.json");

  for (const manifest_path of manifests) {
    const absolute_path = path.join(workspace_root, manifest_path);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(absolute_path, "utf8"));
    } catch {
      continue;
    }
    if (typeof manifest.name !== "string" || !manifest.name.startsWith(scoped_prefix)) continue;

    const exports_field = manifest.exports;
    const has_exports =
      exports_field !== null && typeof exports_field === "object" && !Array.isArray(exports_field);
    const export_keys = new Set(has_exports ? Object.keys(exports_field) : [default_export_key]);
    const symbols = new Set();
    const declaration_targets = [];
    if (has_exports) {
      for (const value of Object.values(exports_field)) {
        const target = typeof value === "string" ? value : value?.types ?? value?.import;
        if (typeof target === "string" && target.endsWith(".d.ts")) declaration_targets.push(target);
      }
    }
    if (declaration_targets.length === 0 && typeof manifest.types === "string") {
      declaration_targets.push(manifest.types);
    }
    for (const target of declaration_targets) {
      const absolute_target = path.join(workspace_root, path.dirname(manifest_path), target);
      for (const name of read_declaration_exports(absolute_target)) symbols.add(name);
    }
    packages.set(manifest.name, { manifest_path, export_keys, has_exports, symbols });
  }

  return packages;
}

/** 递归发现 packages 目录下的最外层 manifest，跳过构建产物目录。 */
function find_package_manifests(absolute_directory) {
  const ignored = new Set([".git", "bin", "dist", "node_modules"]);
  const results = [];
  for (const entry of readdirSync(absolute_directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    const child_directory = path.join(absolute_directory, entry.name);
    const manifest_path = path.join(child_directory, "package.json");
    try {
      if (statSync(manifest_path).isFile()) {
        results.push(path.relative(workspace_root, manifest_path).replaceAll("\\", "/"));
        continue;
      }
    } catch {
      // 没有 manifest 时继续向下递归。
    }
    results.push(...find_package_manifests(child_directory));
  }
  return results;
}

/**
 * 从一段文本中提取全部 `@downcity/*` 引用。
 *
 * 关键点（中文）
 * - 同时覆盖正文行内代码与 import 语句，二者都只是普通文本。
 * - 结尾标点、版本号后缀与实际引用无关，统一裁剪。
 *
 * @param {string} text 待扫描文本。
 * @returns {Array<{ package_name: string; subpath: string | null }>}
 */
export function extract_package_references(text) {
  const references = [];
  const pattern = /@downcity\/([a-z0-9-]+)((?:\/[A-Za-z0-9._-]+)*)/g;
  for (const match of text.matchAll(pattern)) {
    const package_name = `${scoped_prefix}${match[1]}`;
    const raw_subpath = match[2] || "";
    const trimmed_subpath = raw_subpath.replace(/[.,;:)\]]+$/, "").replace(/\/+$/, "");
    references.push({
      package_name,
      subpath: trimmed_subpath ? `.${trimmed_subpath}` : null,
    });
  }
  return references;
}

/**
 * 校验一批引用，返回 error 与 warning 两类问题。
 *
 * @param {Array<{ package_name: string; subpath: string | null }>} references 待校验引用。
 * @param {Map<string, { manifest_path: string; export_keys: Set<string> }>} packages workspace 包表。
 * @returns {{ errors: string[]; warnings: string[] }}
 */
export function check_references(references, packages) {
  const errors = new Set();
  const warnings = new Set();

  for (const reference of references) {
    const entry = packages.get(reference.package_name);
    if (!entry) {
      warnings.add(`未在 workspace 中找到 package：${reference.package_name}`);
      continue;
    }
    if (!reference.subpath) continue;
    if (!entry.export_keys.has(reference.subpath)) {
      errors.add(
        `${reference.package_name}${reference.subpath.slice(1)} 不存在；${entry.manifest_path} 的 exports 只有：${[...entry.export_keys].sort().join(" ")}`,
      );
    }
  }

  return { errors: [...errors].sort(), warnings: [...warnings].sort() };
}

/**
 * 校验一批 import 语句里的符号是否由目标包真实导出。
 *
 * @param {string} text 文件全文。
 * @param {Map<string, { symbols: Set<string> }>} packages workspace 包表。
 * @returns {string[]} 问题描述列表。
 */
export function check_import_symbols(text, packages) {
  const problems = [];
  const pattern = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"(@downcity\/[^"]+)"/g;
  for (const match of text.matchAll(pattern)) {
    const specifier = match[2];
    const package_name = `${scoped_prefix}${specifier.split("/")[1]}`;
    const entry = packages.get(package_name);
    if (!entry) continue;
    for (const piece of match[1].split(",")) {
      const name = piece.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (!name) continue;
      if (!entry.symbols.has(name)) {
        problems.push(`${specifier} 未导出 ${name}`);
      }
    }
  }
  return problems;
}

/** 收集 homepage content 下的全部 mdx 文件。 */
function collect_content_files(absolute_directory) {
  const results = [];
  for (const entry of readdirSync(absolute_directory, { withFileTypes: true })) {
    const child_path = path.join(absolute_directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...collect_content_files(child_path));
      continue;
    }
    if (entry.name.endsWith(".mdx")) results.push(child_path);
  }
  return results;
}

/**
 * 扫描全部文档并汇总问题。
 *
 * @returns {{ errors: string[]; warnings: string[]; file_count: number }}
 */
export function verify_documentation() {
  const packages = read_workspace_package_exports();
  const errors = new Set();
  const warnings = new Set();
  const files = collect_content_files(content_root);

  for (const file_path of files) {
    const text = readFileSync(file_path, "utf8");
    const references = extract_package_references(text);
    const result = check_references(references, packages);
    const symbol_problems = check_import_symbols(text, packages);
    const relative_path = path.relative(workspace_root, file_path).replaceAll("\\", "/");
    for (const error of result.errors) errors.add(`${relative_path}: ${error}`);
    for (const warning of result.warnings) warnings.add(`${relative_path}: ${warning}`);
    for (const problem of symbol_problems) errors.add(`${relative_path}: ${problem}`);
  }

  return { errors: [...errors].sort(), warnings: [...warnings].sort(), file_count: files.length };
}

/** CLI 入口：区分 error 与 warning，仅 error 影响退出码。 */
function main() {
  const { errors, warnings, file_count } = verify_documentation();
  console.log(`Scanned ${file_count} mdx files.`);
  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const warning of warnings) console.log(`  - ${warning}`);
  }
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const error of errors) console.log(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll package subpaths and import symbols resolve.");
}

const current_file = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(current_file).href) {
  main();
}
