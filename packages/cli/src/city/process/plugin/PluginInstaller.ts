/**
 * 第三方单 Plugin 包安装器。
 *
 * 来源目录可以包含源码与任意开发工具；安装目录只保留 `plugin.json`、`package.json`、
 * 自包含 ESM 入口和用户自己的 `config.toml`。Plugin 定义的唯一 ID 同时是公开身份和
 * 最终目录名。
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
const PLUGIN_PACKAGE_FILE_NAME = "package.json";

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
  const source_dir = path.join(plugins_root, `.source-${randomUUID()}`);
  const staging_dir = path.join(plugins_root, `.install-${randomUUID()}`);
  const backup_dir = path.join(plugins_root, `.backup-${randomUUID()}`);
  let revision: string | undefined;

  try {
    let plugin_root = source.local_path;
    if (!plugin_root) {
      const clone_arguments = ["clone", "--depth", "1"];
      if (source.git_ref) clone_arguments.push("--branch", source.git_ref);
      clone_arguments.push(source.git_url!, source_dir);
      await execa("git", clone_arguments, { stdio: "pipe" });
      const revision_result = await execa("git", ["rev-parse", "HEAD"], {
        cwd: source_dir,
        stdio: "pipe",
      });
      revision = revision_result.stdout.trim() || undefined;
      plugin_root = source_dir;
    }

    await assert_plugin_package_file(
      plugin_root,
      PLUGIN_DEFINITION_FILE_NAME,
      "definition",
    );
    const package_path = await assert_plugin_package_file(
      plugin_root,
      PLUGIN_PACKAGE_FILE_NAME,
      "package",
    );
    await validate_plugin_package(package_path);
    const definition = await read_plugin_definition(plugin_root);
    if (expected_plugin_id && definition.id !== normalize_plugin_id(expected_plugin_id)) {
      throw new Error(`Plugin update changed ID: ${expected_plugin_id} -> ${definition.id}`);
    }
    if (is_builtin_plugin(definition.id)) {
      throw new Error(`Plugin ID conflicts with builtin Plugin: ${definition.id}`);
    }
    const entry_path = await assert_plugin_package_file(
      plugin_root,
      definition.entry,
      "entry",
    );
    validate_existing_profiles(definition);

    await fs.ensureDir(staging_dir, { mode: 0o700 });
    const installed_package_path = path.join(staging_dir, PLUGIN_PACKAGE_FILE_NAME);
    await fs.copyFile(package_path, installed_package_path);
    await fs.chmod(installed_package_path, 0o600);
    const installed_entry_path = resolve_plugin_path(staging_dir, definition.entry, "entry");
    await fs.ensureDir(path.dirname(installed_entry_path), { mode: 0o700 });
    await fs.copyFile(entry_path, installed_entry_path);
    await fs.chmod(installed_entry_path, 0o600);
    const integrity = await calculate_plugin_integrity(staging_dir, [
      PLUGIN_PACKAGE_FILE_NAME,
      definition.entry,
    ]);
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
    await fs.remove(source_dir);
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

/**
 * 验证安装协议实际读取的文件。
 *
 * 逐段拒绝符号链接，确保入口不会借助来源目录中的链接改变真实位置。与安装无关的源码、
 * 构建配置和版本库文件不会被读取，也不会进入安装目录。
 */
async function assert_plugin_package_file(
  plugin_root: string,
  relative_path: string,
  label: string,
): Promise<string> {
  const resolved_path = resolve_plugin_path(plugin_root, relative_path, label);
  const normalized_relative_path = path.relative(path.resolve(plugin_root), resolved_path);
  const segments = normalized_relative_path.split(path.sep);
  let current_path = path.resolve(plugin_root);

  for (const [index, segment] of segments.entries()) {
    current_path = path.join(current_path, segment);
    let stats: fs.Stats;
    try {
      stats = await fs.lstat(current_path);
    } catch {
      throw new Error(`Plugin ${label} not found: ${relative_path}`);
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Plugin ${label} cannot use symlinks: ${relative_path}`);
    }
    const is_last_segment = index === segments.length - 1;
    if (!is_last_segment && !stats.isDirectory()) {
      throw new Error(`Plugin ${label} path is invalid: ${relative_path}`);
    }
    if (is_last_segment && !stats.isFile()) {
      throw new Error(`Plugin ${label} must be a file: ${relative_path}`);
    }
  }
  return resolved_path;
}

/** 校验 `package.json` 建立了明确的 ESM package 边界。 */
async function validate_plugin_package(package_path: string): Promise<void> {
  let package_definition: unknown;
  try {
    package_definition = await fs.readJson(package_path);
  } catch (error) {
    throw new Error("Plugin package.json must contain valid JSON", { cause: error });
  }
  if (!is_json_object(package_definition) || package_definition.type !== "module") {
    throw new Error('Plugin package.json must declare "type": "module"');
  }
}

/** 计算 Plugin package 边界与自包含入口的稳定 SHA-256 摘要。 */
async function calculate_plugin_integrity(root: string, files: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const relative_path of [...files].sort((left, right) => left.localeCompare(right))) {
    hash.update(relative_path.split(path.sep).join("/"));
    hash.update("\0");
    hash.update(await fs.readFile(resolve_plugin_path(root, relative_path, "package file")));
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
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
