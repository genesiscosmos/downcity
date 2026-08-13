/**
 * 本地 Plugin Loader。
 *
 * 本模块只负责从本地安装记录与 Resource 创建 Plugin 实例。Workspace、Model、Tool
 * 和 Agent 全部由 CLI/Desktop 组合根显式创建。
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats_plugin from "ajv-formats";
import {
  type JsonObject,
  type Plugin,
} from "@downcity/agent";
import { get_local_plugins_path, resolve_local_root_path } from "@/runtime/LocalPaths.js";
import type { LocalPluginResourceItem } from "@/types/LocalPlugin.js";
import type {
  LocalPluginLoaderOptions,
  LocalPluginType,
} from "@/types/LocalRuntime.js";
import type { LocalAgentConfig } from "@/types/LocalConfig.js";
import type { PluginRepository } from "@/repositories/PluginRepository.js";

const plugin_ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
(formats_plugin as unknown as (ajv: Ajv2020) => Ajv2020)(plugin_ajv);

/** 根据本地配置创建 Plugin 实例并校验第三方安装入口。 */
export class LocalPluginLoader {
  /** 用户级数据根目录。 */
  readonly root_path: string;

  /** 当前宿主读取 Plugin Resource 与 Installation 使用的仓储。 */
  private readonly plugin_repository: PluginRepository;

  /** 宿主显式提供的 Plugin constructor。 */
  private readonly builtin_types: readonly LocalPluginType[];

  constructor(options: LocalPluginLoaderOptions) {
    this.root_path = resolve_local_root_path(options.root_path);
    this.plugin_repository = options.plugin_repository;
    this.builtin_types = [...(options.plugin_types ?? [])];
  }

  /** 根据 Agent 定义创建全部已启用 Plugin。 */
  async create_plugins(config: LocalAgentConfig): Promise<Plugin[]> {
    const plugins: Plugin[] = [];
    for (const definition of config.plugins) {
      if (!definition.enabled) continue;
      const plugin_types = await this.load_plugin_types(definition.plugin_name);
      const plugin_type = plugin_types.find((item) =>
        item.manifest.name === definition.plugin_name
      );
      if (!plugin_type) throw new Error(`Plugin not found: ${definition.plugin_name}`);
      validate_schema_value(definition.config, plugin_type.manifest.config?.schema, "Plugin config");
      const resources = this.resolve_resources(
        definition.plugin_name,
        definition.resource_ids,
      );
      for (const resource of resources) {
        validate_schema_value(resource, plugin_type.manifest.resources?.schema, "Plugin Resource");
      }
      const plugin = new plugin_type({ config: definition.config, resources });
      if (plugin.name !== definition.plugin_name) {
        throw new Error(`Plugin constructor name mismatch: ${definition.plugin_name}`);
      }
      plugins.push(plugin);
    }
    return plugins;
  }

  /** 返回宿主注入的内建 Plugin 类型快照。 */
  plugin_types(): LocalPluginType[] {
    return [...this.builtin_types];
  }

  /** 加载一个 Plugin 所属入口的完整 constructor 集合。 */
  async load_plugin_types(plugin_name: string): Promise<LocalPluginType[]> {
    if (this.builtin_types.some((item) => item.manifest.name === plugin_name)) {
      return [...this.builtin_types];
    }
    return await this.load_installed_types(plugin_name) ?? [];
  }

  /** 读取一个 Plugin Binding 引用的全部解密 Resource。 */
  private resolve_resources(
    plugin_name: string,
    resource_ids: readonly string[],
  ): LocalPluginResourceItem[] {
    return resource_ids.map((resource_id) => {
      const resource = this.plugin_repository.get_resource(plugin_name, resource_id);
      if (!resource) {
        throw new Error(`Plugin Resource not found: ${plugin_name}/${resource_id}`);
      }
      return structuredClone(resource.item) as LocalPluginResourceItem;
    });
  }

  /** 加载并校验第三方 installation 的 ESM 入口。 */
  private async load_installed_types(plugin_name: string): Promise<LocalPluginType[] | null> {
    const installation = this.plugin_repository.list_installations()
      .find((item) => item.manifest.plugins.some((plugin) => plugin.name === plugin_name));
    if (!installation) return null;
    const manifest = installation.manifest;
    const installation_root = path.join(get_local_plugins_path(this.root_path), installation.installation_id);
    const expected_entry = resolve_artifact_path(installation_root, manifest.entry);
    const [real_root, real_entry, stored_entry] = await Promise.all([
      fs.realpath(installation_root),
      fs.realpath(expected_entry),
      fs.realpath(installation.entry_path),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`) || real_entry !== stored_entry) {
      throw new Error(`Installed Plugin entry is invalid: ${installation.installation_id}`);
    }
    const module = await import(pathToFileURL(real_entry).href) as { plugins?: unknown };
    if (!Array.isArray(module.plugins)) {
      throw new Error("Plugin entry must export a plugins array");
    }
    const plugin_types = validate_plugin_types(module.plugins);
    if (canonical_json(plugin_types.map((item) => item.manifest)) !== canonical_json(manifest.plugins)) {
      throw new Error(`Plugin static manifests do not match installed snapshot: ${installation.installation_id}`);
    }
    return plugin_types;
  }

}

/** 按可选 JSON Schema 校验 Plugin 配置或 Resource。 */
function validate_schema_value(value: JsonObject, schema: JsonObject | undefined, label: string): void {
  if (!schema) return;
  const validate = plugin_ajv.compile(schema);
  if (validate(value)) return;
  const details = validate.errors
    ?.map((error) => `${error.instancePath || label} ${error.message || error.keyword}`)
    .join("; ") || "unknown validation error";
  throw new Error(`Invalid ${label}: ${details}`);
}

/** 校验第三方入口导出的 Plugin constructor。 */
function validate_plugin_types(values: unknown[]): LocalPluginType[] {
  const plugin_types = values.map((value, index) => {
    if (typeof value !== "function") {
      throw new Error(`Plugin array item must be a constructor: ${index}`);
    }
    const plugin_type = value as LocalPluginType;
    const manifest = plugin_type.manifest;
    if (!manifest || typeof manifest !== "object" || !manifest.name || !manifest.description) {
      throw new Error(`Plugin constructor static manifest is invalid: ${index}`);
    }
    if (plugin_type.resolve_resource !== undefined && typeof plugin_type.resolve_resource !== "function") {
      throw new Error(`Plugin static resolve_resource must be a function: ${manifest.name}`);
    }
    return plugin_type;
  });
  const names = plugin_types.map((item) => item.manifest.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Plugin constructor manifest names must be unique");
  }
  return plugin_types;
}

/** 安全解析 installation 目录内的入口。 */
function resolve_artifact_path(root_path: string, relative_path: string): string {
  const root = path.resolve(root_path);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Plugin entry must stay inside the installation directory");
  }
  return resolved;
}

/** 生成稳定 JSON，用于比较安装快照。 */
function canonical_json(value: unknown): string {
  return JSON.stringify(sort_json(value));
}

/** 递归排序 JSON object key。 */
function sort_json(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_json);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort_json(item)]));
  }
  return value;
}
