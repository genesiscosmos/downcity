/**
 * 本地 City Plugin Loader。
 *
 * Loader 只解析内置或第三方统一注册。Plugin 实例不由 Loader 创建；同一个入口
 * 导出的实例直接交给 City，由 City 统一持有生命周期。
 */

import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import type {
  CityPluginRegistration,
  PluginDefinition,
  PluginJsonObject,
} from "@/plugin/index.js";
import type {
  LocalInstalledPluginDefinition,
  LocalPluginRegistration,
} from "@/local/types/LocalPlugin.js";
import type { LocalPluginLoaderOptions } from "@/local/types/LocalRuntime.js";

/** 根据本地文件协议解析 City Plugin 注册与宿主配置。 */
export class LocalPluginLoader {
  /** 当前宿主注入的内置 Plugin 注册。 */
  private readonly builtin_registrations: readonly LocalPluginRegistration[];

  constructor(private readonly options: LocalPluginLoaderOptions) {
    this.builtin_registrations = [...(options.plugin_registrations ?? [])];
  }

  /** 按稳定 ID 加载一个内置或第三方 City Plugin 注册。 */
  async load_plugin_registration(plugin_id: string): Promise<CityPluginRegistration | null> {
    const builtin = this.builtin_registrations.find((item) => item.plugin.name === plugin_id);
    if (builtin) return builtin;
    return await this.load_installed_registration(plugin_id);
  }

  /** 列出当前本地宿主能够解析的全部 Plugin 注册。 */
  async list_registrations(): Promise<CityPluginRegistration[]> {
    const installed = await Promise.all(
      this.options.plugin_repository.list_installed()
        .map(async (definition) => await this.load_installed_registration(definition.id)),
    );
    return [
      ...this.builtin_registrations,
      ...installed.filter((item): item is CityPluginRegistration => item !== null),
    ];
  }

  /** 从第三方 Plugin 根目录加载并校验统一 main 模块。 */
  private async load_installed_registration(
    plugin_id: string,
  ): Promise<CityPluginRegistration | null> {
    const definition = this.options.plugin_repository.get_installed(plugin_id);
    if (!definition) return null;
    const plugin_root = this.options.plugin_repository.plugin_path(plugin_id);
    await verify_local_installed_plugin_integrity(plugin_root, definition);
    if (!definition.main) return null;
    const expected_main = resolve_plugin_path(plugin_root, definition.main);
    const [real_root, real_entry] = await Promise.all([
      fs.realpath(plugin_root),
      fs.realpath(expected_main),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`)) {
      throw new Error(`Installed Plugin entry is invalid: ${plugin_id}`);
    }
    const plugin = await load_local_city_plugin(real_entry, definition.integrity);
    if (plugin.name !== definition.id) {
      throw new Error(`Installed Plugin ID does not match its instance: ${definition.id}`);
    }
    return {
      readme: resolve_plugin_path(plugin_root, definition.readme),
      has_config: definition.renderer?.config === true,
      has_sidebar: definition.renderer?.sidebar === true,
      has_mainview: definition.renderer?.mainview === true,
      plugin,
    };
  }
}

/**
 * 加载并校验第三方统一 City Plugin 入口。
 *
 * cache_key 随安装制品变化，避免进程内更新后命中 Node ESM 旧缓存。
 */
export async function load_local_city_plugin(
  main_path: string,
  cache_key: string,
): Promise<PluginDefinition> {
  const module_url = pathToFileURL(main_path);
  module_url.searchParams.set("integrity", cache_key);
  const loaded = await import(module_url.href) as { default?: unknown };
  return normalize_local_plugin(loaded.default);
}

/** 校验第三方入口默认导出的唯一 Plugin 实例。 */
function normalize_local_plugin(value: unknown): PluginDefinition {
  if (is_plugin_definition(value)) return value;
  throw new Error("Plugin entry must default export one Plugin instance");
}

/** 判断未知值是否满足 Plugin 最小定义。 */
function is_plugin_definition(value: unknown): value is PluginDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plugin = value as Partial<PluginDefinition>;
  return typeof plugin.name === "string" && plugin.name.trim().length > 0;
}

/** 校验安装制品完整性，防止已安装入口或运行资源被静默替换。 */
export async function verify_local_installed_plugin_integrity(
  plugin_root: string,
  definition: LocalInstalledPluginDefinition,
): Promise<void> {
  const files = [
    "package.json",
    definition.readme,
    ...[definition.main, definition.renderer?.entry]
      .filter((item): item is string => Boolean(item)),
  ];
  if (definition.icon && !/^https?:\/\//iu.test(definition.icon)) files.push(definition.icon);
  const hash = createHash("sha256");
  for (const relative_path of [...files].sort((left, right) => left.localeCompare(right))) {
    const file_path = resolve_plugin_path(plugin_root, relative_path);
    const stats = await fs.lstat(file_path).catch(() => null);
    if (!stats?.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Installed Plugin file is invalid: ${definition.id}/${relative_path}`);
    }
    hash.update(relative_path.split(path.sep).join("/"));
    hash.update("\0");
    hash.update(await fs.readFile(file_path));
    hash.update("\0");
  }
  const actual_integrity = `sha256-${hash.digest("hex")}`;
  if (actual_integrity !== definition.integrity) {
    throw new Error(`Installed Plugin integrity check failed: ${definition.id}`);
  }
}

/** 安全解析 Plugin 根目录内的入口。 */
function resolve_plugin_path(root_path: string, relative_path: string): string {
  const root = path.resolve(root_path);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Plugin entry must stay inside the Plugin directory");
  }
  return resolved;
}

/** 保留 Plugin Profile 的 JSON object 类型约束。 */
export type LocalPluginProfile = PluginJsonObject;
