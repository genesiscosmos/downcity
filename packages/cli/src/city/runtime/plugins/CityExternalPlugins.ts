/**
 * 第三方 Plugin Runtime Factory 加载器。
 *
 * 关键点（中文）
 * - 动态导入仅用于用户显式安装的 ESM Plugin entry，是扩展边界的必要例外。
 * - Binding 配置由 City 数据库读取并原样传给 Factory，不写入 Plugin 对象协议。
 */

import type { Plugin } from "@downcity/agent";
import { get_installed_plugin } from "@/city/process/registry/PluginRepository.js";
import type { AgentPluginBinding } from "@/city/types/plugin/AgentPluginBinding.js";
import { validate_plugin_config } from "@/city/process/plugin/PluginConfigValidator.js";
import { load_external_plugin_factory } from "@/city/runtime/plugins/PluginModuleLoader.js";
import { resolve_plugin_binding_resources } from "@/city/process/plugin/PluginResourceService.js";

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
    const factory = await load_external_plugin_factory(binding.plugin_name);
    const resources = resolve_plugin_binding_resources(
      binding,
      installed.manifest.resources?.schema,
    );
    const plugin = await factory.create({
      config: binding.config,
      resources,
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
