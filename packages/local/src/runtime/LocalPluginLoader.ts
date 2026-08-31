/**
 * 本地 Plugin Loader。
 *
 * Agent 只引用 Plugin ID 与可选 profile。Loader 统一解析内置或第三方注册、读取
 * `config.toml`，并通过 Plugin 的 Agent factory 创建 Agent 独享的运行实例。
 */

import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import type { JsonObject, Plugin } from "@downcity/agent";
import type { AgentPluginModule, PluginHostContext } from "@downcity/agent";
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
      /** 宿主从 Agent 选定 Profile 读取的配置快照。 */
      profile: JsonObject;
    }) => PluginHostContext | Promise<PluginHostContext>,
  ): Promise<Plugin[]> {
    const plugins: Plugin[] = [];
    for (const [plugin_id, reference] of Object.entries(config.plugins)) {
      const registration = await this.load_plugin_registration(plugin_id);
      if (!registration) throw new Error(`Plugin not found: ${plugin_id}`);
      if (!registration.create_agent) {
        throw new Error(`Plugin does not provide Agent capability: ${plugin_id}`);
      }
      const plugin_config = reference.profile
        ? this.options.plugin_repository.get_profile(plugin_id, reference.profile)
        : {};
      if (!plugin_config) {
        throw new Error(`Plugin profile not found: ${plugin_id}/${reference.profile}`);
      }
      const host_context = await create_plugin_host_context({
        plugin_id,
        profile: plugin_config,
      });
      const plugin = await registration.create_agent(host_context);
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

  /** 从第三方 Plugin 根目录加载并校验 Agent factory。 */
  private async load_installed_registration(
    plugin_id: string,
  ): Promise<LocalPluginRegistration | null> {
    const definition = this.options.plugin_repository.get_installed(plugin_id);
    if (!definition) return null;
    const plugin_root = this.options.plugin_repository.plugin_path(plugin_id);
    await verify_local_installed_plugin_integrity(plugin_root, definition);
    if (!definition.agent) {
      return {
        definition: {
          ...definition,
          has_agent: false,
          has_main: Boolean(definition.main),
          has_renderer: Boolean(definition.renderer),
        },
      };
    }
    const expected_agent = resolve_plugin_path(plugin_root, definition.agent);
    const [real_root, real_entry] = await Promise.all([
      fs.realpath(plugin_root),
      fs.realpath(expected_agent),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`)) {
      throw new Error(`Installed Plugin agent entry is invalid: ${plugin_id}`);
    }
    const module = await load_local_agent_plugin_module(real_entry, definition.integrity);
    return {
      definition: {
        ...definition,
        has_agent: true,
        has_main: Boolean(definition.main),
        has_renderer: Boolean(definition.renderer),
      },
      create_agent: async (context) => await module.default(context),
    };
  }
}

/**
 * 加载并校验第三方 Plugin Agent 模块。
 *
 * `cache_key` 必须随安装制品变化，避免同一进程更新 Plugin 后命中 Node ESM 旧缓存。
 * 本函数只求值模块并读取默认导出，不调用 factory。
 */
export async function load_local_agent_plugin_module(
  agent_path: string,
  cache_key: string,
): Promise<AgentPluginModule<Plugin>> {
  const module_url = pathToFileURL(agent_path);
  module_url.searchParams.set("integrity", cache_key);
  const module = await import(module_url.href) as Partial<AgentPluginModule<Plugin>>;
  if (typeof module.default !== "function") {
    throw new Error("Plugin agent entry must default export a factory function");
  }
  return {
    default: module.default,
  };
}

/** 校验安装制品完整性，防止已安装入口或运行资源被静默替换。 */
export async function verify_local_installed_plugin_integrity(
  plugin_root: string,
  definition: LocalInstalledPluginDefinition,
): Promise<void> {
  const files = [
    "package.json",
    "README.md",
    ...[definition.agent, definition.main, definition.renderer]
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
