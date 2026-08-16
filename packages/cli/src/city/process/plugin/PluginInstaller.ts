/**
 * 第三方单 Plugin 静态制品安装器。
 *
 * Plugin Manifest 声明的唯一 ID 同时是公开身份和最终目录名。随机名称只用于安装
 * staging，更新时仅替换 `plugin.json` 与 `artifact/`，保留用户的 `config.toml`。
 */

import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import type { JsonObject } from "@downcity/agent";
import { get_local_plugin_path } from "@downcity/local";
import { create_cli_local_data } from "@/city/runtime/LocalData.js";
import {
  get_installed_plugin,
  is_builtin_plugin,
  normalize_plugin_id,
  save_installed_plugin,
} from "@/city/process/registry/PluginRepository.js";
import {
  PLUGIN_MANIFEST_FILE_NAME,
  PLUGIN_MANIFEST_VERSION,
  type InstalledPlugin,
  type PluginManifest,
  type ResolvedPluginSource,
} from "@/city/types/plugin/PluginDefinition.js";
import {
  validate_plugin_config,
  validate_plugin_config_schema,
} from "@/city/process/plugin/PluginConfigValidator.js";

/** 从本地目录、Git URL 或 GitHub shorthand 安装一个 Plugin。 */
export async function install_plugin(
  source_input: string,
  expected_plugin_id?: string,
): Promise<InstalledPlugin> {
  const source = await resolve_plugin_source(source_input);
  const data = create_cli_local_data();
  const root_path = data.root_path;
  const plugins_root = path.join(root_path, "plugins");
  data.database.close();
  await fs.ensureDir(plugins_root, { mode: 0o700 });
  const working_dir = path.join(plugins_root, `.install-${randomUUID()}`);
  const artifact_dir = path.join(working_dir, "artifact");
  const backup_dir = path.join(plugins_root, `.backup-${randomUUID()}`);
  let resolved_commit: string | undefined;

  try {
    if (source.local_path) {
      await fs.copy(source.local_path, artifact_dir, {
        filter: (entry) => path.basename(entry) !== ".git",
      });
    } else {
      const clone_arguments = ["clone", "--depth", "1"];
      if (source.git_ref) clone_arguments.push("--branch", source.git_ref);
      clone_arguments.push(source.git_url!, artifact_dir);
      await execa("git", clone_arguments, { stdio: "pipe" });
      const revision = await execa("git", ["rev-parse", "HEAD"], {
        cwd: artifact_dir,
        stdio: "pipe",
      });
      resolved_commit = revision.stdout.trim() || undefined;
      await fs.remove(path.join(artifact_dir, ".git"));
    }

    await assert_plugin_artifact_has_no_symlinks(artifact_dir);
    const manifest = await read_plugin_manifest(artifact_dir);
    if (expected_plugin_id && manifest.id !== normalize_plugin_id(expected_plugin_id)) {
      throw new Error(`Plugin update changed ID: ${expected_plugin_id} -> ${manifest.id}`);
    }
    if (is_builtin_plugin(manifest.id)) {
      throw new Error(`Plugin ID conflicts with builtin Plugin: ${manifest.id}`);
    }
    const entry_path = resolve_plugin_artifact_path(artifact_dir, manifest.entry, "entry");
    if (!await fs.pathExists(entry_path) || !(await fs.stat(entry_path)).isFile()) {
      throw new Error(`Plugin entry not found: ${manifest.entry}`);
    }

    validate_existing_profiles(manifest);
    const integrity = await calculate_plugin_integrity(artifact_dir);
    const existing = get_installed_plugin(manifest.id);
    const target_dir = get_local_plugin_path(root_path, manifest.id);
    const target_artifact = path.join(target_dir, "artifact");
    const target_descriptor = path.join(target_dir, "plugin.json");
    await fs.ensureDir(target_dir, { mode: 0o700 });
    await fs.ensureDir(backup_dir, { mode: 0o700 });
    if (await fs.pathExists(target_artifact)) {
      await fs.move(target_artifact, path.join(backup_dir, "artifact"));
    }
    if (await fs.pathExists(target_descriptor)) {
      await fs.move(target_descriptor, path.join(backup_dir, "plugin.json"));
    }

    try {
      await fs.move(artifact_dir, target_artifact);
      const current_time = new Date().toISOString();
      return save_installed_plugin({
        schema_version: 1,
        id: manifest.id,
        version: manifest.version,
        ...(manifest.title ? { title: manifest.title } : {}),
        description: manifest.description,
        source: source.normalized_source,
        ...(resolved_commit ? { resolved_commit } : {}),
        entry: path.posix.join("artifact", manifest.entry.split(path.sep).join("/")),
        ...(manifest.config?.schema ? { config_schema: manifest.config.schema } : {}),
        ...(manifest.config?.defaults ? { default_config: manifest.config.defaults } : {}),
        integrity,
        installed_at: existing?.installed_at ?? current_time,
        updated_at: current_time,
      });
    } catch (error) {
      await fs.remove(target_artifact);
      await fs.remove(target_descriptor);
      if (await fs.pathExists(path.join(backup_dir, "artifact"))) {
        await fs.move(path.join(backup_dir, "artifact"), target_artifact);
      }
      if (await fs.pathExists(path.join(backup_dir, "plugin.json"))) {
        await fs.move(path.join(backup_dir, "plugin.json"), target_descriptor);
      }
      throw error;
    }
  } finally {
    await fs.remove(working_dir);
    await fs.remove(backup_dir);
  }
}

/** 使用 Plugin 自己保存的来源更新制品。 */
export async function update_plugin(plugin_id_input: string): Promise<InstalledPlugin> {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  const plugin = get_installed_plugin(plugin_id);
  if (!plugin) throw new Error(`Plugin is not installed: ${plugin_id}`);
  return await install_plugin(plugin.source, plugin_id);
}

/** 读取并严格验证单 Plugin 静态清单。 */
export async function read_plugin_manifest(artifact_dir: string): Promise<PluginManifest> {
  const manifest_path = path.join(artifact_dir, PLUGIN_MANIFEST_FILE_NAME);
  if (!await fs.pathExists(manifest_path)) {
    throw new Error(`Missing ${PLUGIN_MANIFEST_FILE_NAME}`);
  }
  const raw = await fs.readJson(manifest_path) as Record<string, unknown>;
  assert_known_fields(
    raw,
    ["manifest_version", "id", "version", "title", "description", "entry", "config"],
    "Plugin manifest",
  );
  if (raw.manifest_version !== PLUGIN_MANIFEST_VERSION) {
    throw new Error(`Plugin manifest_version must be ${PLUGIN_MANIFEST_VERSION}`);
  }
  const id = normalize_plugin_id(String(raw.id || ""));
  if (raw.id !== id) throw new Error(`Plugin manifest ID must be normalized: ${raw.id}`);
  const version = String(raw.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Plugin version must be semantic: ${version}`);
  }
  const description = String(raw.description || "").trim();
  if (!description) throw new Error(`Plugin description is required: ${id}`);
  const entry = String(raw.entry || "").trim();
  if (!entry) throw new Error(`Plugin entry is required: ${id}`);
  resolve_plugin_artifact_path(artifact_dir, entry, "entry");
  let config: PluginManifest["config"];
  if (raw.config !== undefined) {
    if (!is_json_object(raw.config)) throw new Error(`Plugin config must be an object: ${id}`);
    assert_known_fields(raw.config, ["schema", "defaults"], `Plugin config ${id}`);
    if (!is_json_object(raw.config.schema)) {
      throw new Error(`Plugin config.schema must be an object: ${id}`);
    }
    validate_plugin_config_schema(raw.config.schema);
    if (raw.config.defaults !== undefined && !is_json_object(raw.config.defaults)) {
      throw new Error(`Plugin config.defaults must be an object: ${id}`);
    }
    if (raw.config.defaults !== undefined) {
      validate_plugin_config(raw.config.defaults, raw.config.schema);
    }
    config = {
      schema: raw.config.schema,
      ...(raw.config.defaults ? { defaults: raw.config.defaults } : {}),
    };
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  return {
    manifest_version: 4,
    id,
    version,
    ...(title ? { title } : {}),
    description,
    entry,
    ...(config ? { config } : {}),
  };
}

/** 更新前用新 Schema 验证所有已保存 profile。 */
function validate_existing_profiles(manifest: PluginManifest): void {
  if (!manifest.config?.schema) return;
  const data = create_cli_local_data();
  try {
    const profiles = data.plugins.read_config(manifest.id).profiles;
    for (const [profile, config] of Object.entries(profiles)) {
      try {
        validate_plugin_config(config, manifest.config.schema);
      } catch (error) {
        throw new Error(`Plugin profile is incompatible with update: ${manifest.id}/${profile}`, {
          cause: error,
        });
      }
    }
  } finally {
    data.database.close();
  }
}

/** 安全解析 Plugin 制品根目录内的静态路径。 */
export function resolve_plugin_artifact_path(
  artifact_dir: string,
  relative_path: string,
  label: string,
): string {
  const root = path.resolve(artifact_dir);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Plugin ${label} must stay inside the artifact directory`);
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

/** 拒绝符号链接，避免路径与完整性语义漂移。 */
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
  const entries = (await fs.readdir(path.join(root, current), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const relative_path = current ? path.join(current, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await list_plugin_files(root, relative_path));
    if (entry.isFile()) files.push(relative_path);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function is_json_object(value: unknown): value is Record<string, unknown> & JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 拒绝静态 Manifest 中无法识别的字段。 */
function assert_known_fields(
  value: Record<string, unknown>,
  allowed_fields: string[],
  label: string,
): void {
  const allowed = new Set(allowed_fields);
  const unknown_field = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown_field) throw new Error(`${label} contains unknown field: ${unknown_field}`);
}
