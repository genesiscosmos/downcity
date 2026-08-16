/**
 * 本地 Plugin Loader。
 *
 * Agent 只引用 Plugin ID 与可选 profile。Loader 负责解析内置或第三方 constructor、
 * 读取 `config.toml`、执行 Schema 校验并创建 Agent 独享的 Plugin 实例。
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats_plugin from "ajv-formats";
import type { JsonObject, Plugin } from "@downcity/agent";
import type { LocalAgentConfig } from "@/types/LocalConfig.js";
import type {
  LocalPluginLoaderOptions,
  LocalPluginType,
} from "@/types/LocalRuntime.js";

const plugin_ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
(formats_plugin as unknown as (ajv: Ajv2020) => Ajv2020)(plugin_ajv);

/** 根据本地文件协议创建 Plugin 实例。 */
export class LocalPluginLoader {
  /** 当前宿主注入的内置 Plugin constructor。 */
  private readonly builtin_types: readonly LocalPluginType[];

  constructor(private readonly options: LocalPluginLoaderOptions) {
    this.builtin_types = [...(options.plugin_types ?? [])];
  }

  /** 根据 Agent 定义创建全部已注册 Plugin。 */
  async create_plugins(config: LocalAgentConfig): Promise<Plugin[]> {
    const plugins: Plugin[] = [];
    for (const [plugin_id, reference] of Object.entries(config.plugins)) {
      const plugin_type = await this.load_plugin_type(plugin_id);
      if (!plugin_type) throw new Error(`Plugin not found: ${plugin_id}`);
      const profile_id = reference.profile ?? "default";
      const profile = this.options.plugin_repository.get_profile(plugin_id, profile_id);
      if (reference.profile && !profile) {
        throw new Error(`Plugin profile not found: ${plugin_id}/${reference.profile}`);
      }
      const plugin_config = profile
        ?? structuredClone(plugin_type.manifest.config?.defaults ?? {});
      validate_schema_value(
        plugin_config,
        plugin_type.manifest.config?.schema,
        `Plugin profile ${plugin_id}`,
      );
      const plugin = new plugin_type({ config: plugin_config });
      if (plugin.name !== plugin_id) {
        throw new Error(`Plugin constructor ID mismatch: ${plugin_id}`);
      }
      plugins.push(plugin);
    }
    return plugins;
  }

  /** 返回宿主注入的内置 Plugin 类型快照。 */
  plugin_types(): LocalPluginType[] {
    return [...this.builtin_types];
  }

  /** 按稳定 ID 加载一个 Plugin constructor。 */
  async load_plugin_type(plugin_id: string): Promise<LocalPluginType | null> {
    const builtin = this.builtin_types.find((item) => item.manifest.name === plugin_id);
    if (builtin) return builtin;
    return await this.load_installed_type(plugin_id);
  }

  /** 加载并校验第三方 Plugin 的唯一 ESM constructor。 */
  private async load_installed_type(plugin_id: string): Promise<LocalPluginType | null> {
    const descriptor = this.options.plugin_repository.get_installed(plugin_id);
    if (!descriptor) return null;
    const plugin_root = this.options.plugin_repository.plugin_path(plugin_id);
    const expected_entry = resolve_artifact_path(plugin_root, descriptor.entry);
    const [real_root, real_entry] = await Promise.all([
      fs.realpath(plugin_root),
      fs.realpath(expected_entry),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`)) {
      throw new Error(`Installed Plugin entry is invalid: ${plugin_id}`);
    }
    const module = await import(pathToFileURL(real_entry).href) as { plugin?: unknown };
    if (typeof module.plugin !== "function") {
      throw new Error("Plugin entry must export one plugin constructor");
    }
    const plugin_type = module.plugin as LocalPluginType;
    const manifest = plugin_type.manifest;
    if (!manifest || manifest.name !== plugin_id || !manifest.description) {
      throw new Error(`Plugin constructor manifest is invalid: ${plugin_id}`);
    }
    const snapshot = {
      name: descriptor.id,
      version: descriptor.version,
      ...(descriptor.title ? { title: descriptor.title } : {}),
      description: descriptor.description,
      ...(descriptor.config_schema
        ? {
            config: {
              schema: descriptor.config_schema,
              ...(descriptor.default_config
                ? { defaults: descriptor.default_config }
                : {}),
            },
          }
        : {}),
    };
    if (canonical_json(manifest) !== canonical_json(snapshot)) {
      throw new Error(`Plugin manifest does not match installed definition: ${plugin_id}`);
    }
    return plugin_type;
  }
}

/** 按可选 JSON Schema 校验 Plugin profile。 */
function validate_schema_value(
  value: JsonObject,
  schema: JsonObject | undefined,
  label: string,
): void {
  if (!schema) return;
  const validate = plugin_ajv.compile(schema);
  if (validate(value)) return;
  const details = validate.errors
    ?.map((error) => `${error.instancePath || label} ${error.message || error.keyword}`)
    .join("; ") || "unknown validation error";
  throw new Error(`Invalid ${label}: ${details}`);
}

/** 安全解析 Plugin 目录内的入口。 */
function resolve_artifact_path(root_path: string, relative_path: string): string {
  const root = path.resolve(root_path);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Plugin entry must stay inside the Plugin directory");
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
