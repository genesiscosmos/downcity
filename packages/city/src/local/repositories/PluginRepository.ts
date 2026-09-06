/**
 * 文件型 Plugin 定义与唯一配置仓储。
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
} from "@/local/runtime/LocalPaths.js";
import { normalize_plugin_id } from "@/local/repositories/AgentRepository.js";
import type {
  LocalInstalledPluginDefinition,
  LocalPluginConfig,
} from "@/local/types/LocalPlugin.js";

const PLUGIN_FILE_NAME = "plugin.json";
const CONFIG_FILE_NAME = "config.toml";

/** 读取和写入用户级 Plugin 定义与唯一配置。 */
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
      || !is_installed_readme_path(value.readme)
      || (!value.main && !value.renderer)
      || !value.source
      || !value.integrity
      || !value.installed_at
      || !value.updated_at
      || (value.icon !== undefined && typeof value.icon !== "string")
      || (value.main !== undefined && typeof value.main !== "string")
      || (value.renderer !== undefined && !is_installed_renderer(value.renderer))
    ) {
      throw new Error(`Invalid installed Plugin definition: ${plugin_id}`);
    }
    return structuredClone(value);
  }

  /** 读取已安装 Plugin 自己拥有的用户说明；安装完整性由调用方先行校验。 */
  read_installed_readme(plugin_id_input: string, readme_path: string): string {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    const plugin_root = path.resolve(get_local_plugin_path(this.root_path, plugin_id));
    const resolved_path = path.resolve(plugin_root, readme_path);
    if (resolved_path === plugin_root || !resolved_path.startsWith(`${plugin_root}${path.sep}`)) {
      throw new Error(`Plugin README must stay inside the Plugin directory: ${plugin_id}`);
    }
    const real_root = fs.realpathSync(plugin_root);
    const real_readme = fs.realpathSync(resolved_path);
    const stats = fs.lstatSync(resolved_path);
    if (
      !stats.isFile()
      || stats.isSymbolicLink()
      || !real_readme.startsWith(`${real_root}${path.sep}`)
    ) {
      throw new Error(`Plugin README is invalid: ${plugin_id}`);
    }
    return fs.readFileSync(real_readme, "utf8");
  }

  /** 删除整个第三方 Plugin 目录。 */
  remove_installed(plugin_id_input: string): void {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    fs.removeSync(get_local_plugin_path(this.root_path, plugin_id));
  }

  /** 读取 Plugin 的唯一配置；配置文件不存在时返回空对象。 */
  get_config(plugin_id_input: string): JsonObject {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    const file_path = this.config_file_path(plugin_id);
    if (!fs.pathExistsSync(file_path)) return {};
    const raw = parse(fs.readFileSync(file_path, "utf8")) as Partial<LocalPluginConfig>;
    if (raw.schema_version !== 2 || !is_plain_object(raw.config)) {
      throw new Error(`Invalid Plugin config: ${plugin_id}`);
    }
    assert_toml_value(raw.config, plugin_id);
    return structuredClone(raw.config) as JsonObject;
  }

  /** 原子替换 Plugin 的唯一配置。 */
  set_config(
    plugin_id_input: string,
    value: JsonObject,
  ): JsonObject {
    const plugin_id = normalize_plugin_id(plugin_id_input);
    assert_toml_value(value, plugin_id);
    this.write_config(plugin_id, {
      schema_version: 2,
      config: structuredClone(value),
    });
    return structuredClone(value);
  }

  /** 返回 Plugin 稳定目录。 */
  plugin_path(plugin_id_input: string): string {
    return get_local_plugin_path(this.root_path, normalize_plugin_id(plugin_id_input));
  }

  /** 原子写入规范化 TOML。 */
  private write_config(plugin_id: string, config: LocalPluginConfig): void {
    this.write_atomic(
      this.config_file_path(plugin_id),
      stringify({ schema_version: 2, config: config.config }),
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

/** Plugin 配置只允许可无损映射到 TOML 的 JSON 值。 */
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

/** 判断已安装定义是否持有规范、安全的相对 Markdown 文档路径。 */
function is_installed_readme_path(value: unknown): value is string {
  if (typeof value !== "string" || !value || value !== value.trim()) return false;
  if (value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return false;
  }
  return path.posix.extname(value).toLowerCase() === ".md"
    && !value.split("/").includes("..");
}

/** 判断已安装 Renderer 是否包含规范入口和完整静态插槽声明。 */
function is_installed_renderer(
  value: unknown,
): value is LocalInstalledPluginDefinition["renderer"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const renderer = value as Record<string, unknown>;
  if (
    typeof renderer.entry !== "string"
    || typeof renderer.sidebar !== "boolean"
    || typeof renderer.mainview !== "boolean"
    || typeof renderer.config !== "boolean"
  ) return false;
  if (renderer.sidebar !== renderer.mainview) return false;
  return renderer.sidebar || renderer.config;
}
