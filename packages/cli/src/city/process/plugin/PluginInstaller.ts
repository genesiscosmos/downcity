/**
 * 第三方 Plugin 数组静态制品安装器。
 *
 * 关键点（中文）
 * - 入口模块只需导出 `plugins` constructor 数组。
 * - installation 是来源、入口与文件原子替换的内部实现，不进入公开 Plugin 模型。
 * - 安装检查只读取静态 JSON，不执行 npm、生命周期脚本或 Plugin 入口。
 */

import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import type { JsonObject } from "@downcity/agent";
import {
  get_plugin_installation_dir_path,
  get_plugin_installations_dir_path,
} from "@/city/process/registry/CityPaths.js";
import {
  get_installed_plugin,
  get_plugin_installation,
  normalize_plugin_name,
  save_plugin_installation,
} from "@/city/process/registry/PluginRepository.js";
import { list_plugin_catalog } from "@/city/process/plugin/PluginCatalog.js";
import {
  PLUGIN_INSTALLATION_MANIFEST_FILE_NAME,
  PLUGIN_INSTALLATION_MANIFEST_VERSION,
  type InstalledPluginInstallation,
  type PluginInstallationManifest,
  type PluginManifest,
  type ResolvedPluginSource,
} from "@/city/types/plugin/PluginInstallation.js";
import {
  validate_plugin_config,
  validate_plugin_config_schema,
} from "@/city/process/plugin/PluginConfigValidator.js";
import { validate_plugin_resource_schema } from "@/city/process/plugin/PluginResourceSchema.js";
import { assert_plugin_resources_compatible } from "@/city/process/registry/PluginResourceRepository.js";
import { LocalCityStore } from "@downcity/local";

/** 从本地目录、Git 或 GitHub shorthand 安装一个 Plugin 数组制品。 */
export async function install_plugins(
  source_input: string,
  expected_installation_id?: string,
): Promise<InstalledPluginInstallation> {
  const source = await resolve_plugin_source(source_input);
  const installation_id = create_installation_id(source.normalized_source);
  if (expected_installation_id && installation_id !== expected_installation_id) {
    throw new Error("Plugin update source changed its internal installation identity");
  }
  const installations_dir = get_plugin_installations_dir_path();
  await fs.ensureDir(installations_dir);
  const staging_dir = path.join(installations_dir, `.install-${randomUUID()}`);
  const backup_dir = path.join(installations_dir, `.backup-${randomUUID()}`);
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
    const manifest = await read_plugin_installation_manifest(staging_dir);
    assert_plugin_names_available(manifest, installation_id);
    const entry_path = resolve_plugin_artifact_path(staging_dir, manifest.entry, "entry");
    if (!await fs.pathExists(entry_path) || !(await fs.stat(entry_path)).isFile()) {
      throw new Error(`Plugin entry not found: ${manifest.entry}`);
    }

    const existing = get_plugin_installation(installation_id);
    if (existing) assert_installation_update_compatible(existing, manifest);
    const integrity = await calculate_plugin_integrity(staging_dir);
    const target_dir = get_plugin_installation_dir_path(installation_id);
    if (await fs.pathExists(target_dir)) await fs.move(target_dir, backup_dir);

    try {
      await fs.move(staging_dir, target_dir);
      const current_time = new Date().toISOString();
      return save_plugin_installation({
        installation_id,
        source: source.normalized_source,
        ...(resolved_commit ? { resolved_commit } : {}),
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

/** 使用 Plugin 所属 installation 的已保存来源更新整个共享入口。 */
export async function update_plugin(plugin_name_input: string): Promise<InstalledPluginInstallation> {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  const reference = get_installed_plugin(plugin_name);
  if (!reference) throw new Error(`Plugin is not installed: ${plugin_name}`);
  return await install_plugins(
    reference.installation.source,
    reference.installation.installation_id,
  );
}

/** 读取并验证静态安装清单以及内嵌的全部 Plugin Manifest。 */
export async function read_plugin_installation_manifest(
  installation_dir: string,
): Promise<PluginInstallationManifest> {
  const manifest_path = path.join(installation_dir, PLUGIN_INSTALLATION_MANIFEST_FILE_NAME);
  if (!await fs.pathExists(manifest_path)) {
    throw new Error(`Missing ${PLUGIN_INSTALLATION_MANIFEST_FILE_NAME}`);
  }
  const raw = await fs.readJson(manifest_path) as Record<string, unknown>;
  assert_known_fields(raw, ["manifest_version", "entry", "plugins"], "manifest");
  if (raw.manifest_version !== PLUGIN_INSTALLATION_MANIFEST_VERSION) {
    throw new Error(`Plugin manifest_version must be ${PLUGIN_INSTALLATION_MANIFEST_VERSION}`);
  }
  const entry = String(raw.entry || "").trim();
  if (!entry) throw new Error("Plugin manifest entry is required");
  resolve_plugin_artifact_path(installation_dir, entry, "entry");
  if (!Array.isArray(raw.plugins) || raw.plugins.length === 0) {
    throw new Error("Plugin manifest plugins must be a non-empty array");
  }

  const plugins = raw.plugins.map((plugin, index) =>
    read_plugin_manifest(plugin, index)
  );
  const plugin_names = plugins.map((plugin) => plugin.name);
  if (new Set(plugin_names).size !== plugin_names.length) {
    throw new Error("Plugin manifest names must be unique");
  }
  return {
    manifest_version: PLUGIN_INSTALLATION_MANIFEST_VERSION,
    entry,
    plugins,
  };
}

/** 读取并验证一个 Plugin 的静态 Manifest。 */
function read_plugin_manifest(value: unknown, index: number): PluginManifest {
  if (!is_json_object(value)) throw new Error(`Plugin manifest must be an object: ${index}`);
  assert_known_fields(
    value,
    ["name", "version", "title", "description", "config", "resources"],
    `Plugin manifest ${index}`,
  );
  const name = normalize_plugin_name(String(value.name || ""));
  if (name !== value.name) throw new Error(`Plugin manifest name must be normalized: ${value.name}`);
  const version = value.version === undefined ? "" : String(value.version).trim();
  if (version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Plugin version must be semantic: ${version}`);
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    throw new Error(`Plugin title must be a string: ${name}`);
  }
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error(`Plugin description is required: ${name}`);
  }
  let config: PluginManifest["config"];
  if (value.config !== undefined) {
    if (!is_json_object(value.config)) throw new Error(`Plugin config must be an object: ${name}`);
    assert_known_fields(value.config, ["schema", "defaults"], `Plugin config ${name}`);
    if (!is_json_object(value.config.schema)) {
      throw new Error(`Plugin config.schema must be an object: ${name}`);
    }
    validate_plugin_config_schema(value.config.schema);
    if (value.config.defaults !== undefined && !is_json_object(value.config.defaults)) {
      throw new Error(`Plugin config.defaults must be an object: ${name}`);
    }
    if (value.config.defaults !== undefined) {
      validate_plugin_config(value.config.defaults, value.config.schema);
    }
    config = {
      schema: value.config.schema,
      ...(value.config.defaults !== undefined ? { defaults: value.config.defaults } : {}),
    };
  }

  let resources: PluginManifest["resources"];
  if (value.resources !== undefined) {
    if (!is_json_object(value.resources)) {
      throw new Error(`Plugin resources must be an object: ${name}`);
    }
    assert_known_fields(value.resources, ["schema"], `Plugin resources ${name}`);
    if (!is_json_object(value.resources.schema)) {
      throw new Error(`Plugin resources.schema must be an object: ${name}`);
    }
    validate_plugin_resource_schema(value.resources.schema);
    resources = { schema: value.resources.schema };
  }

  const title = typeof value.title === "string" ? value.title.trim() : "";
  const description = value.description.trim();
  return {
    name,
    ...(version ? { version } : {}),
    ...(title ? { title } : {}),
    description,
    ...(config ? { config } : {}),
    ...(resources ? { resources } : {}),
  };
}

/** 确认新数组中的 Plugin 名称不与其他安装或内建 Plugin 冲突。 */
function assert_plugin_names_available(
  manifest: PluginInstallationManifest,
  current_installation_id: string,
): void {
  const catalog = list_plugin_catalog();
  for (const plugin of manifest.plugins) {
    const conflict = catalog.find((item) =>
      item.plugin_name === plugin.name
      && item.installation_id !== current_installation_id
    );
    if (conflict) throw new Error(`Plugin name is already installed: ${plugin.name}`);
  }
}

/** 校验共享入口更新不会破坏已有 Binding 与 Resource。 */
function assert_installation_update_compatible(
  existing: InstalledPluginInstallation,
  next_manifest: PluginInstallationManifest,
): void {
  for (const plugin of existing.manifest.plugins) {
    const next_plugin = next_manifest.plugins.find((item) => item.name === plugin.name);
    if (!next_plugin) assert_plugin_unused(plugin.name);
    if (next_plugin) {
      assert_plugin_resources_compatible(plugin.name, next_plugin.resources?.schema);
    }
  }
}

/** 确认 Plugin 不再被任何 Binding 或 Resource 使用。 */
function assert_plugin_unused(plugin_name: string): void {
  const store = new LocalCityStore();
  try {
    store.assert_plugin_unused(plugin_name);
  } finally {
    store.close();
  }
}

/** 安全解析 Plugin 安装根目录内的静态制品路径。 */
export function resolve_plugin_artifact_path(
  installation_dir: string,
  relative_path: string,
  label: string,
): string {
  const root = path.resolve(installation_dir);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Plugin ${label} must stay inside the installation directory`);
  }
  return resolved;
}

/** 根据规范化来源稳定派生内部 installation ID。 */
function create_installation_id(normalized_source: string): string {
  return `source_${createHash("sha256").update(normalized_source).digest("hex").slice(0, 24)}`;
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
    if (entry.isSymbolicLink()) {
      throw new Error(`Plugin artifact cannot contain symlinks: ${entry.name}`);
    }
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

/** 按相对路径稳定排序枚举 Plugin 制品文件。 */
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
function is_json_object(value: unknown): value is Record<string, unknown> & JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 拒绝静态 Manifest 中无法识别的字段，避免拼写错误被静默忽略。 */
function assert_known_fields(
  value: Record<string, unknown>,
  allowed_fields: string[],
  label: string,
): void {
  const allowed = new Set(allowed_fields);
  const unknown_field = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown_field) throw new Error(`${label} contains unknown field: ${unknown_field}`);
}
