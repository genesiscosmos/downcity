/**
 * 本地 Plugin Loader。
 *
 * Agent 只引用 Plugin ID 与可选 profile。Loader 统一解析内置或第三方注册、读取
 * `config.toml`、执行 `plugin.json` JSON Schema 校验并创建 Agent 独享的 Plugin 实例。
 */

import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import type { JsonObject, Plugin } from "@downcity/agent";
import { validate_local_plugin_config } from "@/runtime/LocalPluginConfigSchema.js";
import type { LocalAgentConfig } from "@/types/LocalConfig.js";
import type {
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
  async create_plugins(config: LocalAgentConfig): Promise<Plugin[]> {
    const plugins: Plugin[] = [];
    for (const [plugin_id, reference] of Object.entries(config.plugins)) {
      const registration = await this.load_plugin_registration(plugin_id);
      if (!registration) throw new Error(`Plugin not found: ${plugin_id}`);
      const profile_id = reference.profile ?? "default";
      const profile = this.options.plugin_repository.get_profile(plugin_id, profile_id);
      if (reference.profile && !profile) {
        throw new Error(`Plugin profile not found: ${plugin_id}/${reference.profile}`);
      }
      const plugin_config = profile
        ?? structuredClone(registration.definition.config?.defaults ?? {});
      validate_local_plugin_config(
        plugin_config,
        registration.definition.config?.schema,
        `Plugin profile ${plugin_id}`,
      );
      const plugin = registration.create(plugin_config);
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

  /** 从第三方 Plugin 根目录加载并校验 constructor。 */
  private async load_installed_registration(
    plugin_id: string,
  ): Promise<LocalPluginRegistration | null> {
    const definition = this.options.plugin_repository.get_installed(plugin_id);
    if (!definition) return null;
    const plugin_root = this.options.plugin_repository.plugin_path(plugin_id);
    await verify_installed_plugin_integrity(plugin_root, definition);
    const expected_entry = resolve_plugin_path(plugin_root, definition.entry);
    const [real_root, real_entry] = await Promise.all([
      fs.realpath(plugin_root),
      fs.realpath(expected_entry),
    ]);
    if (!real_entry.startsWith(`${real_root}${path.sep}`)) {
      throw new Error(`Installed Plugin entry is invalid: ${plugin_id}`);
    }
    const module = await import(pathToFileURL(real_entry).href) as { plugin?: unknown };
    if (typeof module.plugin !== "function") {
      throw new Error("Plugin entry must export plugin constructor");
    }
    const plugin_constructor = module.plugin as PluginConstructor;
    return {
      definition,
      create: (profile) => new plugin_constructor(profile),
    };
  }
}

/** 校验安装制品完整性，防止已安装入口或运行资源被静默替换。 */
async function verify_installed_plugin_integrity(
  plugin_root: string,
  definition: LocalPluginRegistration["definition"] & {
    entry: string;
    integrity: string;
  },
): Promise<void> {
  const files = ["package.json", "README.md", definition.entry];
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

/** 第三方入口导出的 Plugin constructor。 */
type PluginConstructor = {
  /** 使用已校验配置创建 Agent 独享实例。 */
  new(profile: JsonObject): Plugin;
};

/** 安全解析 Plugin 根目录内的入口。 */
function resolve_plugin_path(root_path: string, relative_path: string): string {
  const root = path.resolve(root_path);
  const resolved = path.resolve(root, relative_path);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Plugin entry must stay inside the Plugin directory");
  }
  return resolved;
}
