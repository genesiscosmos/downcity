/**
 * 本地 City Plugin Loader。
 *
 * Loader 只解析内置或第三方统一 main 注册，并把 Agent 配置转换为声明式绑定；
 * Plugin 实例创建、共享、生命周期与 execution lease 全部由 City 完成。
 */

import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import type { CityAgentPluginBinding } from "@/city/types/CityPlugin.js";
import type {
  CityPluginModule,
  CityPluginRegistration,
  PluginJsonObject,
} from "@/plugin/index.js";
import type { LocalAgentConfig } from "@/local/types/LocalConfig.js";
import type {
  LocalInstalledPluginDefinition,
  LocalPluginRegistration,
} from "@/local/types/LocalPlugin.js";
import type { LocalPluginLoaderOptions } from "@/local/types/LocalRuntime.js";

/** 根据本地文件协议解析 City Plugin 注册与 Agent 绑定。 */
export class LocalPluginLoader {
  /** 当前宿主注入的内置 Plugin 注册。 */
  private readonly builtin_registrations: readonly LocalPluginRegistration[];

  constructor(private readonly options: LocalPluginLoaderOptions) {
    this.builtin_registrations = [...(options.plugin_registrations ?? [])];
  }

  /** 根据 Agent 定义创建不包含 Plugin 实例的 City 绑定。 */
  async create_bindings(config: LocalAgentConfig): Promise<CityAgentPluginBinding[]> {
    const bindings: CityAgentPluginBinding[] = [];
    for (const [plugin_id, reference] of Object.entries(config.plugins)) {
      const registration = await this.load_plugin_registration(plugin_id);
      if (!registration) throw new Error(`Plugin not found: ${plugin_id}`);
      if (reference.profile && !registration.has_config) {
        throw new Error(`Plugin does not provide Config: ${plugin_id}`);
      }
      const profile_config = reference.profile
        ? this.options.plugin_repository.get_profile(plugin_id, reference.profile)
        : {};
      if (!profile_config) {
        throw new Error(`Plugin profile not found: ${plugin_id}/${reference.profile}`);
      }
      bindings.push({
        plugin_id,
        profile: {
          id: reference.profile || "default",
          config: profile_config,
        },
      });
    }
    return bindings;
  }

  /** 按稳定 ID 加载一个内置或第三方 City Plugin 注册。 */
  async load_plugin_registration(plugin_id: string): Promise<CityPluginRegistration | null> {
    const builtin = this.builtin_registrations.find((item) => item.id === plugin_id);
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
      throw new Error(`Installed Plugin main entry is invalid: ${plugin_id}`);
    }
    const module = await load_local_city_plugin_module(real_entry, definition.integrity);
    return {
      id: definition.id,
      title: definition.title || definition.id,
      description: definition.description,
      readme: resolve_plugin_path(plugin_root, definition.readme),
      has_config: definition.renderer?.config === true,
      has_sidebar: definition.renderer?.sidebar === true,
      has_mainview: definition.renderer?.mainview === true,
      module,
    };
  }
}

/**
 * 加载并校验第三方统一 City Plugin main。
 *
 * cache_key 随安装制品变化，避免进程内更新后命中 Node ESM 旧缓存。
 */
export async function load_local_city_plugin_module(
  main_path: string,
  cache_key: string,
): Promise<CityPluginModule> {
  const module_url = pathToFileURL(main_path);
  module_url.searchParams.set("integrity", cache_key);
  const loaded = await import(module_url.href) as { default?: unknown };
  if (!is_city_plugin_module(loaded.default)) {
    throw new Error("Plugin main must default export a CityPluginModule");
  }
  return loaded.default;
}

/** 判断未知默认导出是否包含统一 main 与执行 factory。 */
function is_city_plugin_module(value: unknown): value is CityPluginModule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const module = value as Partial<CityPluginModule>;
  return typeof module.activate === "function"
    && typeof module.create === "function"
    && (module.deactivate === undefined || typeof module.deactivate === "function");
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
