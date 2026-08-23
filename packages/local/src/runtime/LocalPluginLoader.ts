/**
 * 本地 Plugin Loader。
 *
 * Agent 只引用 Plugin ID 与可选 profile。Loader 统一解析内置或第三方注册、读取
 * `config.toml`、执行 Plugin setup 导出的 Schema 校验并创建 Agent 独享的 Plugin 实例。
 */

import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import type { JsonObject, Plugin } from "@downcity/agent";
import type { PluginHostContext, PluginSetupModule } from "@downcity/agent";
import {
  validate_local_plugin_config,
  validate_local_plugin_config_schema,
} from "@/runtime/LocalPluginConfigSchema.js";
import type { LocalAgentConfig } from "@/types/LocalConfig.js";
import type {
  LocalInstalledPluginDefinition,
  LocalPluginRegistration,
} from "@/types/LocalPlugin.js";
import type { LocalPluginLoaderOptions } from "@/types/LocalRuntime.js";

/** 根据本地文件协议创建 Plugin 实例。 */
export class LocalPluginLoader {
  /** 当前宿主注入的内置 Plugin 注册。 */
  private readonly builtin_registrations: readonly LocalPluginRegistration[];

  constructor(private readonly options: LocalPluginLoaderOptions) {
    this.builtin_registrations = [...(options.plugin_registrations ?? [])];
  }

  /** 根据 Agent 定义创建全部已注册 Plugin。 */
  async create_plugins(
    config: LocalAgentConfig,
    create_plugin_host_context: (input: {
      /** 当前 Plugin 稳定 ID。 */
      plugin_id: string;
      /** 已完成 schema 校验的 Plugin profile。 */
      profile: JsonObject;
    }) => PluginHostContext | Promise<PluginHostContext>,
  ): Promise<Plugin[]> {
    const plugins: Plugin[] = [];
    for (const [plugin_id, reference] of Object.entries(config.plugins)) {
      const registration = await this.load_plugin_registration(plugin_id);
      if (!registration) throw new Error(`Plugin not found: ${plugin_id}`);
      const plugin_config = reference.profile
        ? this.options.plugin_repository.get_profile(plugin_id, reference.profile)
        : {};
      if (!plugin_config) {
        throw new Error(`Plugin profile not found: ${plugin_id}/${reference.profile}`);
      }
      validate_local_plugin_config(
        plugin_config,
        registration.definition.config?.schema,
        `Plugin profile ${plugin_id}`,
      );
      const host_context = await create_plugin_host_context({
        plugin_id,
        profile: plugin_config,
      });
      const plugin = await registration.setup(host_context);
      if (plugin.name !== plugin_id) {
        throw new Error(`Plugin instance ID does not match definition: ${plugin_id}`);
      }
      plugins.push(plugin);
    }
    return plugins;
  }

  /** 按稳定 ID 加载一个 Plugin 注册。 */
  private async load_plugin_registration(
    plugin_id: string,
  ): Promise<LocalPluginRegistration | null> {
    const builtin = this.builtin_registrations
      .find((item) => item.definition.id === plugin_id);
    if (builtin) return builtin;
    return await this.load_installed_registration(plugin_id);
  }

  /** 从第三方 Plugin 根目录加载并校验 setup 模块。 */
  private async load_installed_registration(
    plugin_id: string,
  ): Promise<LocalPluginRegistration | null> {
    const definition = this.options.plugin_repository.get_installed(plugin_id);
    if (!definition) return null;
    const plugin_root = this.options.plugin_repository.plugin_path(plugin_id);
    await verify_local_installed_plugin_integrity(plugin_root, definition);
    const expected_setup = resolve_plugin_path(plugin_root, definition.setup);
    const [real_root, real_entry] = await Promise.all([
      fs.realpath(plugin_root),
      fs.realpath(expected_setup),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`)) {
      throw new Error(`Installed Plugin setup is invalid: ${plugin_id}`);
    }
    const module = await load_local_plugin_setup_module(real_entry, definition.integrity);
    return {
      definition: {
        ...definition,
        config: { schema: module.schema },
      },
      setup: async (context) => await module.setup(context),
    };
  }
}

/**
 * 加载并校验第三方 Plugin setup 模块。
 *
 * `cache_key` 必须随安装制品变化，避免同一进程更新 Plugin 后命中 Node ESM 旧缓存。
 * 本函数只求值模块并读取静态导出，不调用 `setup()`。
 */
export async function load_local_plugin_setup_module(
  setup_path: string,
  cache_key: string,
): Promise<PluginSetupModule<Plugin>> {
  const module_url = pathToFileURL(setup_path);
  module_url.searchParams.set("integrity", cache_key);
  const module = await import(module_url.href) as Partial<PluginSetupModule<Plugin>>;
  if (!is_json_object(module.schema)) {
    throw new Error("Plugin setup must export a JSON object schema");
  }
  validate_local_plugin_config_schema(module.schema);
  if (typeof module.setup !== "function") {
    throw new Error("Plugin setup must export setup(context)");
  }
  return {
    schema: structuredClone(module.schema!),
    setup: module.setup,
  };
}

/** 校验安装制品完整性，防止已安装入口或运行资源被静默替换。 */
export async function verify_local_installed_plugin_integrity(
  plugin_root: string,
  definition: LocalInstalledPluginDefinition,
): Promise<void> {
  const files = ["package.json", "README.md", definition.setup];
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
    throw new Error("Plugin setup must stay inside the Plugin directory");
  }
  return resolved;
}

/** 判断未知值是否为 JSON object。 */
function is_json_object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
