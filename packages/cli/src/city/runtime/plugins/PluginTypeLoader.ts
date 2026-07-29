/**
 * Plugin constructor 数组加载器。
 *
 * 关键点（中文）
 * - 第三方入口只允许命名导出 `plugins` 数组。
 * - 每个 constructor 的静态 Manifest 必须与安装时读取的 JSON 快照一致。
 * - 内建与安装来源只在 Loader 边界区分，之后统一返回 PluginType 数组。
 */

import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "fs-extra";
import { get_plugin_catalog_item } from "@/city/process/plugin/PluginCatalog.js";
import { get_plugin_installation } from "@/city/process/registry/PluginRepository.js";
import { get_plugin_installation_dir_path } from "@/city/process/registry/CityPaths.js";
import { resolve_plugin_artifact_path } from "@/city/process/plugin/PluginInstaller.js";
import { create_downcity_plugin_types } from "@/city/runtime/plugins/DowncityPlugins.js";
import type {
  PluginManifest,
  PluginType,
} from "@/city/types/plugin/PluginInstallation.js";

/** 加载内建 Plugin 时可用的 City 宿主依赖。 */
export interface PluginTypeLoadContext {
  /** 宿主显式注入的环境变量。 */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;

  /** 当前 Agent HTTP runtime 的监听 host。 */
  host?: string;

  /** 当前 Agent HTTP runtime 的监听 port。 */
  port?: number;
}

/** 加载指定 Plugin 所属入口导出的完整 constructor 数组。 */
export async function load_plugin_types(
  plugin_name: string,
  context: PluginTypeLoadContext = {},
): Promise<PluginType[]> {
  const builtin_types = validate_plugin_types(create_downcity_plugin_types(context));
  if (builtin_types.some((plugin_type) => plugin_type.manifest.name === plugin_name)) {
    return builtin_types;
  }
  const catalog_item = get_plugin_catalog_item(plugin_name);
  if (!catalog_item) throw new Error(`Plugin not found: ${plugin_name}`);
  if (!catalog_item.installation_id) {
    throw new Error(`Installed Plugin is missing installation metadata: ${plugin_name}`);
  }
  return await load_installed_plugin_types(catalog_item.installation_id);
}

/** 按 Plugin 名称读取一个 constructor。 */
export async function load_plugin_type(
  plugin_name: string,
  context: PluginTypeLoadContext = {},
): Promise<PluginType> {
  const plugin_types = await load_plugin_types(plugin_name, context);
  const plugin_type = plugin_types.find((item) => item.manifest.name === plugin_name);
  if (!plugin_type) throw new Error(`Plugin constructor not found: ${plugin_name}`);
  return plugin_type;
}

/** 安全加载并校验一个用户安装入口导出的 Plugin constructor 数组。 */
async function load_installed_plugin_types(installation_id: string): Promise<PluginType[]> {
  const installation = get_plugin_installation(installation_id);
  if (!installation) throw new Error(`Plugin installation not found: ${installation_id}`);
  const installation_dir = get_plugin_installation_dir_path(installation_id);
  const expected_entry = resolve_plugin_artifact_path(
    installation_dir,
    installation.manifest.entry,
    "entry",
  );
  const [real_root, real_entry, installed_entry] = await Promise.all([
    fs.realpath(installation_dir),
    fs.realpath(expected_entry),
    fs.realpath(installation.entry_path),
  ]);
  if (!real_entry.startsWith(`${real_root}${path.sep}`) || real_entry !== installed_entry) {
    throw new Error(`Installed Plugin entry is invalid: ${installation_id}`);
  }
  const module = await import(pathToFileURL(real_entry).href) as {
    /** 入口唯一允许的运行导出。 */
    plugins?: unknown;
  };
  if (!Array.isArray(module.plugins)) {
    throw new Error("Plugin entry must export a plugins array");
  }
  const plugin_types = validate_plugin_types(module.plugins);
  const runtime_manifests = plugin_types.map((plugin_type) => plugin_type.manifest);
  if (canonical_json(runtime_manifests) !== canonical_json(installation.manifest.plugins)) {
    throw new Error(`Plugin static manifests do not match installed snapshot: ${installation_id}`);
  }
  return plugin_types;
}

/** 校验数组元素是带静态 Manifest 的可构造 Plugin 类型。 */
function validate_plugin_types(values: unknown[]): PluginType[] {
  const plugin_types = values.map((value, index) => {
    if (typeof value !== "function") {
      throw new Error(`Plugin array item must be a constructor: ${index}`);
    }
    const plugin_type = value as PluginType;
    const manifest = plugin_type.manifest as PluginManifest | undefined;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error(`Plugin constructor static manifest is required: ${index}`);
    }
    if (typeof manifest.name !== "string" || !manifest.name) {
      throw new Error(`Plugin constructor manifest name is required: ${index}`);
    }
    if (
      plugin_type.resolve_resource !== undefined
      && typeof plugin_type.resolve_resource !== "function"
    ) {
      throw new Error(`Plugin static resolve_resource must be a function: ${manifest.name}`);
    }
    return plugin_type;
  });
  const names = plugin_types.map((plugin_type) => plugin_type.manifest.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Plugin constructor manifest names must be unique");
  }
  return plugin_types;
}

/** 对 JSON 值递归排序 key，用于比较静态 Manifest 的语义快照。 */
function canonical_json(value: unknown): string {
  return JSON.stringify(sort_json(value));
}

/** 递归生成稳定 key 顺序的 JSON 值。 */
function sort_json(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_json);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sort_json(item)]),
    );
  }
  return value;
}
