/**
 * 第三方 Plugin 制品安装器。
 *
 * 关键点（中文）
 * - 支持本地目录与 Git 仓库来源。
 * - 安装过程不执行 npm install、postinstall 或任意仓库脚本。
 * - 仓库必须提交已构建的 ESM entry，且 entry 不得逃逸 Plugin 根目录。
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import {
  get_installed_plugin_dir_path,
  get_installed_plugins_dir_path,
} from "@/city/process/registry/CityPaths.js";
import {
  get_installed_plugin,
  normalize_plugin_name,
  save_installed_plugin,
} from "@/city/process/registry/PluginRepository.js";
import {
  PLUGIN_MANIFEST_FILE_NAME,
  type InstalledPlugin,
  type PluginManifest,
} from "@/city/types/plugin/PluginManifest.js";
import { validate_plugin_config } from "@/city/process/plugin/PluginConfigValidator.js";

/** 安装一个本地目录或 Git 仓库 Plugin。 */
export async function install_plugin(source_input: string): Promise<InstalledPlugin> {
  const source = String(source_input || "").trim();
  if (!source) throw new Error("Plugin source is required");
  const plugins_dir = get_installed_plugins_dir_path();
  await fs.ensureDir(plugins_dir);
  const staging_dir = path.join(plugins_dir, `.install-${randomUUID()}`);
  const backup_dir = path.join(plugins_dir, `.backup-${randomUUID()}`);
  try {
    const local_source = path.resolve(source);
    if (await fs.pathExists(local_source)) {
      const stat = await fs.stat(local_source);
      if (!stat.isDirectory()) throw new Error("Local plugin source must be a directory");
      await fs.copy(local_source, staging_dir, {
        filter: (entry) => path.basename(entry) !== ".git",
      });
    } else {
      await execa("git", ["clone", "--depth", "1", source, staging_dir], {
        stdio: "pipe",
      });
      await fs.remove(path.join(staging_dir, ".git"));
    }

    const manifest = await read_plugin_manifest(staging_dir);
    if (manifest.default_config) {
      validate_plugin_config(manifest.default_config, manifest.config_schema);
    }
    const plugin_name = normalize_plugin_name(manifest.name);
    const entry_path = resolve_plugin_entry(staging_dir, manifest.entry);
    if (!await fs.pathExists(entry_path)) {
      throw new Error(`Plugin entry not found: ${manifest.entry}`);
    }
    const [real_root, real_entry] = await Promise.all([
      fs.realpath(staging_dir),
      fs.realpath(entry_path),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`)) {
      throw new Error("Plugin entry symlink must stay inside the plugin directory");
    }
    if (!(await fs.stat(real_entry)).isFile()) {
      throw new Error("Plugin entry must be a file");
    }
    const target_dir = get_installed_plugin_dir_path(plugin_name);
    const existing = get_installed_plugin(plugin_name);
    if (await fs.pathExists(target_dir)) await fs.move(target_dir, backup_dir);
    try {
      await fs.move(staging_dir, target_dir);
      const current_time = new Date().toISOString();
      const installed = save_installed_plugin({
        plugin_name,
        source,
        version: manifest.version,
        entry_path: resolve_plugin_entry(target_dir, manifest.entry),
        manifest,
        installed_at: existing?.installed_at ?? current_time,
        updated_at: current_time,
      });
      return installed;
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

/** 读取并验证 Plugin Manifest 的必填字段。 */
export async function read_plugin_manifest(plugin_dir: string): Promise<PluginManifest> {
  const manifest_path = path.join(plugin_dir, PLUGIN_MANIFEST_FILE_NAME);
  if (!await fs.pathExists(manifest_path)) {
    throw new Error(`Missing ${PLUGIN_MANIFEST_FILE_NAME}`);
  }
  const raw = await fs.readJson(manifest_path) as Record<string, unknown>;
  const name = normalize_plugin_name(String(raw.name || ""));
  const version = String(raw.version || "").trim();
  const entry = String(raw.entry || "").trim();
  if (!version) throw new Error("Plugin manifest version is required");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Plugin manifest version must be semantic: ${version}`);
  }
  if (!entry) throw new Error("Plugin manifest entry is required");
  resolve_plugin_entry(plugin_dir, entry);
  return {
    name,
    version,
    entry,
    ...(typeof raw.title === "string" ? { title: raw.title } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(is_json_object(raw.config_schema) ? { config_schema: raw.config_schema } : {}),
    ...(is_json_object(raw.default_config) ? { default_config: raw.default_config } : {}),
  };
}

/** 安全解析 Plugin 根目录内的 entry。 */
export function resolve_plugin_entry(plugin_dir: string, entry: string): string {
  const root = path.resolve(plugin_dir);
  const resolved = path.resolve(root, entry);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Plugin entry must stay inside the plugin directory");
  }
  return resolved;
}

/** 判断未知值是否为 JSON 对象。 */
function is_json_object(value: unknown): value is import("@downcity/agent").JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
