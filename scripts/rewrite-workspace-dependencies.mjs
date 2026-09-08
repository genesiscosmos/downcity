/**
 * @file npm 发布前的 workspace 依赖改写工具。
 *
 * npm 原生命令不会把 `workspace:*` / `workspace:^` 改写成可发布的 semver，
 * 因此直接 `npm publish` 会产出无法被 npm registry 消费的 package.json。
 * 该脚本在 `prepack` 阶段临时改写当前包的依赖版本，并在 `postpack` 阶段恢复原文件。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 会被检查并改写的依赖字段。
 */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * 备份文件存放在 node_modules 下，避免进入 npm tarball。
 */
const BACKUP_RELATIVE_PATH = path.join(
  "node_modules",
  ".downcity-pack",
  "package.json.backup",
);

/**
 * 读取 JSON 文件。
 *
 * @param {string} file_path JSON 文件路径。
 * @returns {unknown} 解析后的 JSON。
 */
function read_json(file_path) {
  return JSON.parse(fs.readFileSync(file_path, "utf8"));
}

/**
 * 写入格式化 JSON 文件。
 *
 * @param {string} file_path JSON 文件路径。
 * @param {unknown} value JSON 内容。
 */
function write_json(file_path, value) {
  fs.writeFileSync(file_path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * 向上寻找 workspace 根目录。
 *
 * @param {string} start_dir 起始目录。
 * @returns {string} workspace 根目录。
 */
function find_workspace_root(start_dir) {
  let current_dir = path.resolve(start_dir);

  while (true) {
    if (fs.existsSync(path.join(current_dir, "pnpm-workspace.yaml"))) {
      return current_dir;
    }

    const parent_dir = path.dirname(current_dir);
    if (parent_dir === current_dir) {
      throw new Error(`Cannot find pnpm-workspace.yaml from ${start_dir}`);
    }
    current_dir = parent_dir;
  }
}

/**
 * 列出可能包含 workspace package 的目录。
 *
 * @param {string} workspace_root workspace 根目录。
 * @returns {string[]} package.json 路径列表。
 */
function list_workspace_manifest_paths(workspace_root) {
  const manifest_paths = [];
  const ignored_directories = new Set([".git", "bin", "build", "dist", "node_modules"]);
  const pending_directories = [workspace_root];

  while (pending_directories.length > 0) {
    const current_dir = pending_directories.pop();
    if (!current_dir) continue;
    const manifest_path = path.join(current_dir, "package.json");
    if (fs.existsSync(manifest_path)) manifest_paths.push(manifest_path);

    for (const entry of fs.readdirSync(current_dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || ignored_directories.has(entry.name)) continue;
      pending_directories.push(path.join(current_dir, entry.name));
    }
  }

  return manifest_paths;
}

/**
 * 读取 workspace 内 package 的版本映射。
 *
 * @param {string} workspace_root workspace 根目录。
 * @returns {Map<string, string>} package name 到 version 的映射。
 */
function read_workspace_versions(workspace_root) {
  const versions = new Map();

  for (const manifest_path of list_workspace_manifest_paths(workspace_root)) {
    const manifest = read_json(manifest_path);
    if (
      manifest &&
      typeof manifest === "object" &&
      typeof manifest.name === "string" &&
      typeof manifest.version === "string"
    ) {
      versions.set(manifest.name, manifest.version);
    }
  }

  return versions;
}

/**
 * 将 workspace range 转成 npm 可发布 range。
 *
 * @param {string} dependency_name 依赖包名。
 * @param {string} workspace_range workspace range。
 * @param {Map<string, string>} versions workspace 版本映射。
 * @returns {string | null} 改写后的版本；null 表示无需改写。
 */
function resolve_publish_range(dependency_name, workspace_range, versions) {
  if (!workspace_range.startsWith("workspace:")) return null;

  const version = versions.get(dependency_name);
  if (!version) {
    throw new Error(`Cannot resolve workspace dependency version: ${dependency_name}`);
  }

  const requested_range = workspace_range.slice("workspace:".length).trim();
  if (requested_range === "" || requested_range === "*") return version;
  if (requested_range === "^") return `^${version}`;
  if (requested_range === "~") return `~${version}`;
  if (requested_range.startsWith("^") || requested_range.startsWith("~")) {
    return requested_range;
  }

  return requested_range;
}

/**
 * 改写 manifest 中的 workspace 依赖。
 *
 * @param {Record<string, unknown>} manifest package.json 内容。
 * @param {Map<string, string>} versions workspace 版本映射。
 * @returns {boolean} 是否发生改写。
 */
function rewrite_manifest_dependencies(manifest, versions) {
  let changed = false;

  for (const field_name of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field_name];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }

    for (const [dependency_name, dependency_range] of Object.entries(dependencies)) {
      if (typeof dependency_range !== "string") continue;

      const publish_range = resolve_publish_range(
        dependency_name,
        dependency_range,
        versions,
      );
      if (publish_range === null) continue;

      dependencies[dependency_name] = publish_range;
      changed = true;
    }
  }

  return changed;
}

/**
 * 准备 npm pack/publish 的 package.json。
 *
 * @param {string} manifest_path 当前 package.json 路径。
 */
function prepare_manifest(manifest_path) {
  const package_dir = path.dirname(manifest_path);
  const backup_path = path.join(package_dir, BACKUP_RELATIVE_PATH);
  const raw_manifest = fs.readFileSync(manifest_path, "utf8");
  const manifest = JSON.parse(raw_manifest);
  const workspace_root = find_workspace_root(package_dir);
  const versions = read_workspace_versions(workspace_root);

  if (!rewrite_manifest_dependencies(manifest, versions)) {
    return;
  }

  fs.mkdirSync(path.dirname(backup_path), { recursive: true });
  if (!fs.existsSync(backup_path)) {
    fs.writeFileSync(backup_path, raw_manifest, "utf8");
  }

  write_json(manifest_path, manifest);
}

/**
 * 恢复 npm pack/publish 前的 package.json。
 *
 * @param {string} manifest_path 当前 package.json 路径。
 */
function restore_manifest(manifest_path) {
  const package_dir = path.dirname(manifest_path);
  const backup_path = path.join(package_dir, BACKUP_RELATIVE_PATH);

  if (!fs.existsSync(backup_path)) {
    return;
  }

  fs.copyFileSync(backup_path, manifest_path);
  fs.rmSync(path.dirname(backup_path), { recursive: true, force: true });
}

const [mode, manifest_argument = "./package.json"] = process.argv.slice(2);
const manifest_path = path.resolve(manifest_argument);

if (mode === "prepare") {
  prepare_manifest(manifest_path);
} else if (mode === "restore") {
  restore_manifest(manifest_path);
} else {
  throw new Error("Usage: node scripts/rewrite-workspace-dependencies.mjs prepare|restore ./package.json");
}
