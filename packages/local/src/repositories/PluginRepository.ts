/**
 * 文件型 Plugin 定义与 profile 仓储。
 *
 * 每个 Plugin 使用自己的稳定 ID 目录。第三方描述保存在 `plugin.json`，全部用户配置
 * 以明文 TOML 保存在 `config.toml`；数据库不保存 Plugin 的任何副本。
 */

import path from "node:path";
import fs from "fs-extra";
import { parse, stringify } from "smol-toml";
import type { JsonObject, JsonValue } from "@downcity/agent";
import {
  get_local_plugin_path,
  get_local_plugins_path,
  resolve_local_root_path,
} from "@/runtime/LocalPaths.js";
import { normalize_plugin_id } from "@/repositories/AgentRepository.js";
import type {
  LocalInstalledPluginDefinition,
  LocalPluginConfig,
} from "@/types/LocalPlugin.js";

const PLUGIN_FILE_NAME = "plugin.json";
const CONFIG_FILE_NAME = "config.toml";

/** 读取和写入用户级 Plugin 定义与配置。 */
export class PluginRepository {
  /** Downcity 用户级数据根目录。 */
  readonly root_path: string;

  constructor(root_path_input?: string) {
    this.root_path = resolve_local_root_path(root_path_input);
  }

  /** 列出全部第三方 Plugin 定义。 */
  list_installed(): LocalInstalledPluginDefinition[] {
    const plugins_path = get_local_plugins_path(this.root_path);
    if (!fs.pathExistsSync(plugins_path)) return [];
    return fs.readdirSync(plugins_path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => this.get_installed(entry.name))
      .filter((item): item is LocalInstalledPluginDefinition => item !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** 按 Plugin ID 读取第三方定义；内置 Plugin 没有该文件。 */
  get_installed(plugin_id_input: string): LocalInstalledPluginDefinition | null {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    const file_path = this.plugin_file_path(plugin_id);
    if (!fs.pathExistsSync(file_path)) return null;
    const value = JSON.parse(fs.readFileSync(file_path, "utf8")) as LocalInstalledPluginDefinition;
    if (
      value.schema_version !== 1
      || value.id !== plugin_id
      || !value.version
      || !value.description
      || !value.entry
      || !value.source
      || !value.integrity
      || !value.installed_at
      || !value.updated_at
      || (
        value.config !== undefined
        && (!is_plain_object(value.config) || !is_plain_object(value.config.schema))
      )
    ) {
      throw new Error(`Invalid installed Plugin definition: ${plugin_id}`);
    }
    return structuredClone(value);
  }

  /** 删除整个第三方 Plugin；调用方必须先完成 Agent 引用检查。 */
  remove_installed(plugin_id_input: string): void {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    fs.removeSync(get_local_plugin_path(this.root_path, plugin_id));
  }

  /** 读取 Plugin 的全部 profile；配置文件不存在时返回空集合。 */
  read_config(plugin_id_input: string): LocalPluginConfig {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    const file_path = this.config_file_path(plugin_id);
    if (!fs.pathExistsSync(file_path)) return { schema_version: 1, profiles: {} };
    const raw = parse(fs.readFileSync(file_path, "utf8")) as Record<string, unknown>;
    if (raw.schema_version !== 1 || !is_plain_object(raw.profiles)) {
      throw new Error(`Invalid Plugin config: ${plugin_id}`);
    }
    return {
      schema_version: 1,
      profiles: normalize_profiles(raw.profiles),
    };
  }

  /** 读取指定 profile。 */
  get_profile(plugin_id_input: string, profile_input: string): JsonObject | null {
    const profile = normalize_profile_id(profile_input);
    const config = this.read_config(plugin_id_input);
    return config.profiles[profile]
      ? structuredClone(config.profiles[profile])
      : null;
  }

  /** 新建或替换指定 profile。 */
  save_profile(
    plugin_id_input: string,
    profile_input: string,
    value: JsonObject,
  ): JsonObject {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    const profile = normalize_profile_id(profile_input);
    assert_toml_value(value, `${plugin_id}.${profile}`);
    const current = this.read_config(plugin_id);
    const profiles = {
      ...current.profiles,
      [profile]: structuredClone(value),
    };
    this.write_config(plugin_id, { schema_version: 1, profiles });
    return structuredClone(value);
  }

  /** 删除指定 profile；调用方必须先完成 Agent 引用检查。 */
  remove_profile(plugin_id_input: string, profile_input: string): void {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    const profile = normalize_profile_id(profile_input);
    const current = this.read_config(plugin_id);
    const profiles = { ...current.profiles };
    delete profiles[profile];
    this.write_config(plugin_id, { schema_version: 1, profiles });
  }

  /** 返回 Plugin 稳定目录。 */
  plugin_path(plugin_id_input: string): string {
    return get_local_plugin_path(this.root_path, normalize_plugin_id(plugin_id_input));
  }

  /** 原子写入规范化 TOML。 */
  private write_config(plugin_id: string, config: LocalPluginConfig): void {
    const ordered_profiles = Object.fromEntries(
      Object.entries(config.profiles).sort(([left], [right]) => left.localeCompare(right)),
    );
    this.write_atomic(
      this.config_file_path(plugin_id),
      stringify({ schema_version: 1, profiles: ordered_profiles }),
    );
  }

  /** 使用同目录临时文件提交完整内容。 */
  private write_atomic(file_path: string, content: string): void {
    fs.ensureDirSync(path.dirname(file_path), { mode: 0o700 });
    fs.chmodSync(path.dirname(file_path), 0o700);
    const temp_path = `${file_path}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp_path, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp_path, file_path);
    fs.chmodSync(file_path, 0o600);
  }

  private plugin_file_path(plugin_id: string): string {
    return path.join(get_local_plugin_path(this.root_path, plugin_id), PLUGIN_FILE_NAME);
  }

  private config_file_path(plugin_id: string): string {
    return path.join(get_local_plugin_path(this.root_path, plugin_id), CONFIG_FILE_NAME);
  }
}

/** 规范化 Plugin profile ID。 */
export function normalize_profile_id(input: string): string {
  const profile = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(profile)) {
    throw new Error(`Invalid Plugin profile: ${input}`);
  }
  return profile;
}

/** 把 TOML table 收窄为 Plugin profile 表。 */
function normalize_profiles(input: Record<string, unknown>): Record<string, JsonObject> {
  return Object.fromEntries(Object.entries(input).map(([profile_id, value]) => {
    const profile = normalize_profile_id(profile_id);
    if (!is_plain_object(value)) throw new Error(`Invalid Plugin profile: ${profile}`);
    assert_toml_value(value, profile);
    return [profile, structuredClone(value) as JsonObject];
  }));
}

/** Plugin profile 只允许可无损映射到 TOML 的 JSON 值。 */
function assert_toml_value(value: unknown, path_label: string): asserts value is JsonValue {
  if (value === null || value === undefined || typeof value === "bigint") {
    throw new Error(`Plugin config value is not TOML-compatible: ${path_label}`);
  }
  if (["string", "boolean", "number"].includes(typeof value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assert_toml_value(item, `${path_label}[${index}]`));
    return;
  }
  if (is_plain_object(value)) {
    for (const [key, item] of Object.entries(value)) {
      assert_toml_value(item, `${path_label}.${key}`);
    }
    return;
  }
  throw new Error(`Plugin config value is not TOML-compatible: ${path_label}`);
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
