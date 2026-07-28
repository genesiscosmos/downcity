/**
 * 第三方 Plugin 静态制品安装器。
 *
 * 关键点（中文）
 * - 支持本地目录、Git URL 与 `github:owner/repo#ref`。
 * - 安装检查只读取静态 JSON，不执行 npm、生命周期脚本或 Plugin 入口。
 * - 制品必须提交构建后的自包含 ESM，并通过原子目录替换完成更新。
 */

import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import {
  get_installed_plugin_dir_path,
  get_installed_plugins_dir_path,
} from "@/city/process/registry/CityPaths.js";
import {
  get_installed_plugin,
  is_builtin_plugin,
  normalize_plugin_name,
  save_installed_plugin,
} from "@/city/process/registry/PluginRepository.js";
import {
  PLUGIN_MANIFEST_FILE_NAME,
  PLUGIN_MANIFEST_VERSION,
  type InstalledPlugin,
  type PluginManifest,
  type PluginManifestFile,
  type ResolvedPluginSource,
} from "@/city/types/plugin/PluginManifest.js";
import {
  validate_plugin_config,
  validate_plugin_config_schema,
} from "@/city/process/plugin/PluginConfigValidator.js";
import type { JsonObject } from "@downcity/agent";

/** 从本地目录、Git 或 GitHub shorthand 安装一个 Plugin。 */
export async function install_plugin(
  source_input: string,
  expected_plugin_name?: string,
): Promise<InstalledPlugin> {
  const source = await resolve_plugin_source(source_input);
  const plugins_dir = get_installed_plugins_dir_path();
  await fs.ensureDir(plugins_dir);
  const staging_dir = path.join(plugins_dir, `.install-${randomUUID()}`);
  const backup_dir = path.join(plugins_dir, `.backup-${randomUUID()}`);
  let resolved_commit: string | undefined;

  try {
    if (source.local_path) {
      await fs.copy(source.local_path, staging_dir, {
        filter: (entry) => path.basename(entry) !== ".git",
      });
    } else {
      const clone_arguments = ["clone", "--depth", "1"];
      if (source.git_ref) clone_arguments.push("--branch", source.git_ref);
      clone_arguments.push(source.git_url!, staging_dir);
      await execa("git", clone_arguments, { stdio: "pipe" });
      const revision = await execa("git", ["rev-parse", "HEAD"], {
        cwd: staging_dir,
        stdio: "pipe",
      });
      resolved_commit = revision.stdout.trim() || undefined;
      await fs.remove(path.join(staging_dir, ".git"));
    }

    await assert_plugin_artifact_has_no_symlinks(staging_dir);
    const manifest = await read_plugin_manifest(staging_dir);
    const plugin_name = normalize_plugin_name(manifest.name);
    if (is_builtin_plugin(plugin_name)) {
      throw new Error(`Plugin name is reserved by a built-in Plugin: ${plugin_name}`);
    }
    if (expected_plugin_name && plugin_name !== expected_plugin_name) {
      throw new Error(
        `Plugin update name mismatch: expected ${expected_plugin_name}, received ${plugin_name}`,
      );
    }
    const entry_path = resolve_plugin_artifact_path(staging_dir, manifest.entry, "entry");
    if (!await fs.pathExists(entry_path) || !(await fs.stat(entry_path)).isFile()) {
      throw new Error(`Plugin entry not found: ${manifest.entry}`);
    }

    const integrity = await calculate_plugin_integrity(staging_dir);
    const target_dir = get_installed_plugin_dir_path(plugin_name);
    const existing = get_installed_plugin(plugin_name);
    if (await fs.pathExists(target_dir)) await fs.move(target_dir, backup_dir);

    try {
      await fs.move(staging_dir, target_dir);
      const current_time = new Date().toISOString();
      return save_installed_plugin({
        plugin_name,
        source: source.normalized_source,
        ...(resolved_commit ? { resolved_commit } : {}),
        version: manifest.version,
        entry_path: resolve_plugin_artifact_path(target_dir, manifest.entry, "entry"),
        manifest,
        integrity,
        installed_at: existing?.installed_at ?? current_time,
        updated_at: current_time,
      });
    } catch (error) {
      await fs.remove(target_dir);
      if (await fs.pathExists(backup_dir)) await fs.move(backup_dir, target_dir);
      throw error;
    }
  } finally {
    await fs.remove(staging_dir);
    await fs.remove(backup_dir);
  }
}

/** 使用已保存来源更新一个已安装 Plugin。 */
export async function update_plugin(plugin_name_input: string): Promise<InstalledPlugin> {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  const installed = get_installed_plugin(plugin_name);
  if (!installed) throw new Error(`Plugin is not installed: ${plugin_name}`);
  return await install_plugin(installed.source, plugin_name);
}

/** 读取并验证仓库 Manifest、配置 Schema 和默认配置。 */
export async function read_plugin_manifest(plugin_dir: string): Promise<PluginManifest> {
  const manifest_path = path.join(plugin_dir, PLUGIN_MANIFEST_FILE_NAME);
  if (!await fs.pathExists(manifest_path)) {
    throw new Error(`Missing ${PLUGIN_MANIFEST_FILE_NAME}`);
  }
  const raw = await fs.readJson(manifest_path) as Partial<PluginManifestFile>;
  if (raw.manifest_version !== PLUGIN_MANIFEST_VERSION) {
    throw new Error(`Plugin manifest_version must be ${PLUGIN_MANIFEST_VERSION}`);
  }
  const name = normalize_plugin_name(String(raw.name || ""));
  const version = String(raw.version || "").trim();
  const entry = String(raw.entry || "").trim();
  if (!version) throw new Error("Plugin manifest version is required");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Plugin manifest version must be semantic: ${version}`);
  }
  if (!entry) throw new Error("Plugin manifest entry is required");
  resolve_plugin_artifact_path(plugin_dir, entry, "entry");

  let config: PluginManifest["config"];
  if (raw.config !== undefined) {
    if (!is_json_object(raw.config)) throw new Error("Plugin manifest config must be an object");
    const schema_path = String(raw.config.schema || "").trim();
    if (!schema_path) throw new Error("Plugin manifest config.schema is required");
    const absolute_schema_path = resolve_plugin_artifact_path(
      plugin_dir,
      schema_path,
      "config schema",
    );
    if (path.extname(absolute_schema_path).toLowerCase() !== ".json") {
      throw new Error("Plugin config schema must be a JSON file");
    }
    const schema_value = await fs.readJson(absolute_schema_path) as unknown;
    if (!is_json_object(schema_value)) throw new Error("Plugin config schema must be an object");
    validate_plugin_config_schema(schema_value);
    if (raw.config.defaults !== undefined && !is_json_object(raw.config.defaults)) {
      throw new Error("Plugin manifest config.defaults must be an object");
    }
    const defaults = raw.config.defaults;
    if (defaults) validate_plugin_config(defaults, schema_value);
    config = { schema_path, schema: schema_value, ...(defaults ? { defaults } : {}) };
  }

  return {
    manifest_version: PLUGIN_MANIFEST_VERSION,
    name,
    version,
    entry,
    ...(typeof raw.title === "string" && raw.title.trim() ? { title: raw.title.trim() } : {}),
    ...(typeof raw.description === "string" && raw.description.trim()
      ? { description: raw.description.trim() }
      : {}),
    ...(config ? { config } : {}),
  };
}

/** 安全解析 Plugin 根目录内的静态制品路径。 */
export function resolve_plugin_artifact_path(
  plugin_dir: string,
  relative_path: string,
  label: string,
): string {
  const root = path.resolve(plugin_dir);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Plugin ${label} must stay inside the plugin directory`);
  }
  return resolved;
}

/** 解析 local、Git URL 与 GitHub shorthand。 */
async function resolve_plugin_source(source_input: string): Promise<ResolvedPluginSource> {
  const source = String(source_input || "").trim();
  if (!source) throw new Error("Plugin source is required");

  const local_path = path.resolve(source);
  if (await fs.pathExists(local_path)) {
    if (!(await fs.stat(local_path)).isDirectory()) {
      throw new Error("Local Plugin source must be a directory");
    }
    return { normalized_source: local_path, local_path };
  }

  const github_match = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:#(.+))?$/u.exec(source);
  if (github_match) {
    const owner = github_match[1]!;
    const repository = github_match[2]!.replace(/\.git$/u, "");
    const git_ref = github_match[3]?.trim() || undefined;
    return {
      normalized_source: `github:${owner}/${repository}${git_ref ? `#${git_ref}` : ""}`,
      git_url: `https://github.com/${owner}/${repository}.git`,
      ...(git_ref ? { git_ref } : {}),
    };
  }

  const fragment_index = source.lastIndexOf("#");
  const git_url = fragment_index > 0 ? source.slice(0, fragment_index) : source;
  const git_ref = fragment_index > 0 ? source.slice(fragment_index + 1).trim() : "";
  if (!/^(?:https?:\/\/|ssh:\/\/|git@)[^\s]+$/u.test(git_url)) {
    throw new Error("Plugin source must be a local directory, Git URL, or github:owner/repo#ref");
  }
  return {
    normalized_source: `${git_url}${git_ref ? `#${git_ref}` : ""}`,
    git_url,
    ...(git_ref ? { git_ref } : {}),
  };
}

/** 拒绝带符号链接的 Plugin 制品，避免路径和完整性语义漂移。 */
async function assert_plugin_artifact_has_no_symlinks(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute_path = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Plugin artifact cannot contain symlinks: ${entry.name}`);
    if (entry.isDirectory()) await assert_plugin_artifact_has_no_symlinks(absolute_path);
  }
}

/** 计算 Plugin 全部静态文件的稳定 SHA-256 摘要。 */
async function calculate_plugin_integrity(root: string): Promise<string> {
  const hash = createHash("sha256");
  const files = await list_plugin_files(root);
  for (const relative_path of files) {
    hash.update(relative_path.split(path.sep).join("/"));
    hash.update("\0");
    hash.update(await fs.readFile(path.join(root, relative_path)));
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
}

/** 按相对路径稳定排序枚举制品文件。 */
async function list_plugin_files(root: string, current = ""): Promise<string[]> {
  const directory = path.join(root, current);
  const entries = (await fs.readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const relative_path = current ? path.join(current, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await list_plugin_files(root, relative_path));
    if (entry.isFile()) files.push(relative_path);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/** 判断未知值是否为 JSON 对象。 */
function is_json_object(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
