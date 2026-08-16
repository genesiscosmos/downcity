/**
 * 第三方单 Plugin 目录安装器。
 *
 * Plugin 定义的唯一 ID 同时是公开身份和最终目录名。随机名称只用于 staging；更新
 * 原子替换整个 Plugin 目录，同时保留用户自己的 `config.toml`。
 */

import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import type { JsonObject } from "@downcity/agent";
import { get_local_plugin_path } from "@downcity/local";
import {
  validate_local_plugin_config,
  validate_local_plugin_config_schema,
} from "@downcity/local/product";
import { create_cli_local_data } from "@/city/runtime/LocalData.js";
import {
  get_installed_plugin,
  is_builtin_plugin,
  normalize_plugin_id,
} from "@/city/process/registry/PluginRepository.js";
import {
  PLUGIN_DEFINITION_FILE_NAME,
  PLUGIN_DEFINITION_SCHEMA_VERSION,
  type InstalledPlugin,
  type PluginPackageDefinition,
  type ResolvedPluginSource,
} from "@/city/types/plugin/PluginDefinition.js";

const PLUGIN_CONFIG_FILE_NAME = "config.toml";

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
  const staging_dir = path.join(plugins_root, `.install-${randomUUID()}`);
  const backup_dir = path.join(plugins_root, `.backup-${randomUUID()}`);
  let revision: string | undefined;

  try {
    if (source.local_path) {
      await copy_local_plugin_source(source.local_path, staging_dir);
    } else {
      const clone_arguments = ["clone", "--depth", "1"];
      if (source.git_ref) clone_arguments.push("--branch", source.git_ref);
      clone_arguments.push(source.git_url!, staging_dir);
      await execa("git", clone_arguments, { stdio: "pipe" });
      const revision_result = await execa("git", ["rev-parse", "HEAD"], {
        cwd: staging_dir,
        stdio: "pipe",
      });
      revision = revision_result.stdout.trim() || undefined;
      await fs.remove(path.join(staging_dir, ".git"));
      await fs.remove(path.join(staging_dir, PLUGIN_CONFIG_FILE_NAME));
    }
    await fs.chmod(staging_dir, 0o700);

    await assert_plugin_has_no_symlinks(staging_dir);
    const definition = await read_plugin_definition(staging_dir);
    if (expected_plugin_id && definition.id !== normalize_plugin_id(expected_plugin_id)) {
      throw new Error(`Plugin update changed ID: ${expected_plugin_id} -> ${definition.id}`);
    }
    if (is_builtin_plugin(definition.id)) {
      throw new Error(`Plugin ID conflicts with builtin Plugin: ${definition.id}`);
    }
    const entry_path = resolve_plugin_path(staging_dir, definition.entry, "entry");
    if (!await fs.pathExists(entry_path) || !(await fs.stat(entry_path)).isFile()) {
      throw new Error(`Plugin entry not found: ${definition.entry}`);
    }
    validate_existing_profiles(definition);

    const integrity = await calculate_plugin_integrity(staging_dir);
    const existing = get_installed_plugin(definition.id);
    const target_dir = get_local_plugin_path(root_path, definition.id);
    const existing_config = path.join(target_dir, PLUGIN_CONFIG_FILE_NAME);
    if (await fs.pathExists(existing_config)) {
      await fs.copy(existing_config, path.join(staging_dir, PLUGIN_CONFIG_FILE_NAME));
    }
    const current_time = new Date().toISOString();
    const installed: InstalledPlugin = {
      ...definition,
      source: source.normalized_source,
      ...(revision ? { revision } : {}),
      integrity,
      installed_at: existing?.installed_at ?? current_time,
      updated_at: current_time,
    };
    await fs.writeJson(path.join(staging_dir, PLUGIN_DEFINITION_FILE_NAME), installed, {
      spaces: 2,
      EOL: "\n",
    });
    await fs.chmod(path.join(staging_dir, PLUGIN_DEFINITION_FILE_NAME), 0o600);

    if (await fs.pathExists(target_dir)) await fs.move(target_dir, backup_dir);
    try {
      await fs.move(staging_dir, target_dir);
    } catch (error) {
      await fs.remove(target_dir);
      if (await fs.pathExists(backup_dir)) await fs.move(backup_dir, target_dir);
      throw error;
    }
    await fs.remove(backup_dir);
    return installed;
  } finally {
    await fs.remove(staging_dir);
    await fs.remove(backup_dir);
  }
}

/** 使用 Plugin 自己保存的来源更新目录。 */
export async function update_plugin(plugin_id_input: string): Promise<InstalledPlugin> {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  const plugin = get_installed_plugin(plugin_id);
  if (!plugin) throw new Error(`Plugin is not installed: ${plugin_id}`);
  return await install_plugin(plugin.source, plugin_id);
}

/** 读取并严格验证 Plugin 根目录中的唯一静态定义。 */
export async function read_plugin_definition(
  plugin_root: string,
): Promise<PluginPackageDefinition> {
  const definition_path = path.join(plugin_root, PLUGIN_DEFINITION_FILE_NAME);
  if (!await fs.pathExists(definition_path)) {
    throw new Error(`Missing ${PLUGIN_DEFINITION_FILE_NAME}`);
  }
  const raw = await fs.readJson(definition_path) as Record<string, unknown>;
  assert_known_fields(
    raw,
    [
      "schema_version",
      "id",
      "version",
      "title",
      "description",
      "entry",
      "config",
      "source",
      "revision",
      "integrity",
      "installed_at",
      "updated_at",
    ],
    "Plugin definition",
  );
  if (raw.schema_version !== PLUGIN_DEFINITION_SCHEMA_VERSION) {
    throw new Error(
      `Plugin schema_version must be ${PLUGIN_DEFINITION_SCHEMA_VERSION}`,
    );
  }
  const id = normalize_plugin_id(String(raw.id || ""));
  if (raw.id !== id) throw new Error(`Plugin ID must be normalized: ${raw.id}`);
  const version = String(raw.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Plugin version must be semantic: ${version}`);
  }
  const description = String(raw.description || "").trim();
  if (!description) throw new Error(`Plugin description is required: ${id}`);
  const entry = String(raw.entry || "").trim();
  if (!entry) throw new Error(`Plugin entry is required: ${id}`);
  resolve_plugin_path(plugin_root, entry, "entry");
  let config: PluginPackageDefinition["config"];
  if (raw.config !== undefined) {
    if (!is_json_object(raw.config)) throw new Error(`Plugin config must be an object: ${id}`);
    assert_known_fields(raw.config, ["schema", "defaults"], `Plugin config ${id}`);
    if (!is_json_object(raw.config.schema)) {
      throw new Error(`Plugin config.schema must be an object: ${id}`);
    }
    const config_schema = structuredClone(raw.config.schema) as JsonObject;
    validate_local_plugin_config_schema(config_schema);
    if (raw.config.defaults !== undefined && !is_json_object(raw.config.defaults)) {
      throw new Error(`Plugin config.defaults must be an object: ${id}`);
    }
    const config_defaults = is_json_object(raw.config.defaults)
      ? structuredClone(raw.config.defaults) as JsonObject
      : undefined;
    if (config_defaults) {
      validate_local_plugin_config(config_defaults, config_schema);
    }
    config = {
      schema: config_schema,
      ...(config_defaults ? { defaults: config_defaults } : {}),
    };
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  return {
    schema_version: 1,
    id,
    version,
    ...(title ? { title } : {}),
    description,
    entry: entry.split(path.sep).join("/"),
    ...(config ? { config } : {}),
  };
}

/** 更新前用 `plugin.json` Schema 验证全部已保存 profile。 */
function validate_existing_profiles(definition: PluginPackageDefinition): void {
  if (!definition.config?.schema) return;
  const data = create_cli_local_data();
  try {
    const profiles = data.plugins.read_config(definition.id).profiles;
    for (const [profile, config] of Object.entries(profiles)) {
      try {
        validate_local_plugin_config(config, definition.config.schema);
      } catch (error) {
        throw new Error(
          `Plugin profile is incompatible with update: ${definition.id}/${profile}`,
          { cause: error },
        );
      }
    }
  } finally {
    data.database.close();
  }
}

/** 安全解析 Plugin 根目录内的静态路径。 */
export function resolve_plugin_path(
  plugin_root: string,
  relative_path: string,
  label: string,
): string {
  const root = path.resolve(plugin_root);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Plugin ${label} must stay inside the Plugin directory`);
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

/** 复制本地 Plugin，同时拒绝把来源仓库和用户配置装入静态目录。 */
async function copy_local_plugin_source(source_root: string, target_root: string): Promise<void> {
  await fs.copy(source_root, target_root, {
    filter: (source_path) => {
      const relative_path = path.relative(source_root, source_path);
      if (!relative_path) return true;
      const segments = relative_path.split(path.sep);
      if (segments.includes(".git")) return false;
      return relative_path !== PLUGIN_CONFIG_FILE_NAME;
    },
  });
}

/** 拒绝符号链接，避免路径与完整性语义漂移。 */
async function assert_plugin_has_no_symlinks(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute_path = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Plugin directory cannot contain symlinks: ${entry.name}`);
    }
    if (entry.isDirectory()) await assert_plugin_has_no_symlinks(absolute_path);
  }
}

/** 计算 Plugin 全部静态代码与资源的稳定 SHA-256 摘要。 */
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

/** 按相对路径稳定排序枚举 Plugin 静态文件。 */
async function list_plugin_files(root: string, current = ""): Promise<string[]> {
  const entries = (await fs.readdir(path.join(root, current), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const relative_path = current ? path.join(current, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await list_plugin_files(root, relative_path));
    if (
      entry.isFile()
      && relative_path !== PLUGIN_DEFINITION_FILE_NAME
      && relative_path !== PLUGIN_CONFIG_FILE_NAME
    ) {
      files.push(relative_path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/** 拒绝 Plugin definition 中无法识别的字段。 */
function assert_known_fields(
  value: Record<string, unknown>,
  allowed_fields: string[],
  label: string,
): void {
  const allowed = new Set(allowed_fields);
  const unknown_field = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown_field) throw new Error(`${label} contains unknown field: ${unknown_field}`);
}

/** 判断外部 JSON 值是否为普通对象。 */
function is_json_object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
