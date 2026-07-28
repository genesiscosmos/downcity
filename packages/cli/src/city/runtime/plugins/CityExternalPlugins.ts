/**
 * 第三方 Plugin Runtime Factory 加载器。
 *
 * 关键点（中文）
 * - 动态导入仅用于用户显式安装的 ESM Plugin entry，是扩展边界的必要例外。
 * - Binding 配置由 City 数据库读取并原样传给 Factory，不写入 Plugin 对象协议。
 */

import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "fs-extra";
import type { Plugin } from "@downcity/agent";
import { get_installed_plugin } from "@/city/process/registry/PluginRepository.js";
import type { AgentPluginBinding } from "@/city/types/plugin/AgentPluginBinding.js";
import type { ExternalPluginFactory } from "@/city/types/plugin/PluginManifest.js";
import { validate_plugin_config } from "@/city/process/plugin/PluginConfigValidator.js";
import { get_installed_plugin_dir_path } from "@/city/process/registry/CityPaths.js";
import { resolve_plugin_artifact_path } from "@/city/process/plugin/PluginInstaller.js";

/** 为一个 Agent 实例化全部已启用的第三方 Plugin。 */
export async function create_external_plugins(input: {
  /** 当前 Agent 的全部 Binding。 */
  bindings: AgentPluginBinding[];
}): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  for (const binding of input.bindings) {
    if (!binding.enabled) continue;
    const installed = get_installed_plugin(binding.plugin_name);
    if (!installed) continue;
    validate_plugin_config(binding.config, installed.manifest.config?.schema);
    const plugin_dir = get_installed_plugin_dir_path(binding.plugin_name);
    const expected_entry = resolve_plugin_artifact_path(
      plugin_dir,
      installed.manifest.entry,
      "entry",
    );
    const [real_root, real_entry] = await Promise.all([
      fs.realpath(plugin_dir),
      fs.realpath(expected_entry),
    ]);
    if (
      !real_entry.startsWith(`${real_root}${path.sep}`)
      || real_entry !== await fs.realpath(installed.entry_path)
    ) {
      throw new Error(`Installed Plugin entry is invalid: ${binding.plugin_name}`);
    }
    const module = await import(pathToFileURL(real_entry).href) as {
      plugin_factory?: ExternalPluginFactory;
      default?: ExternalPluginFactory;
    };
    const factory = module.plugin_factory ?? module.default;
    if (!factory || typeof factory.create !== "function") {
      throw new Error(`Plugin entry must export plugin_factory.create: ${binding.plugin_name}`);
    }
    const plugin = await factory.create({
      config: binding.config,
    });
    if (plugin.name !== binding.plugin_name) {
      throw new Error(
        `Plugin factory name mismatch: expected ${binding.plugin_name}, received ${plugin.name}`,
      );
    }
    plugins.push(plugin);
  }
  return plugins;
}
