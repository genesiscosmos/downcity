/**
 * Agent Plugin 统一装配器。
 *
 * 关键点（中文）
 * - 装配器是唯一 Plugin Factory，统一执行 `new PluginType({ config, resources })`。
 * - 同一个安装入口在一次装配中只加载一次，公开模型仍然只有 Plugin。
 * - 实例 name 必须与 constructor 静态 Manifest 和 Binding 名称一致。
 */

import type { Plugin } from "@downcity/agent";
import { get_plugin_catalog_item } from "@/city/process/plugin/PluginCatalog.js";
import { validate_plugin_config } from "@/city/process/plugin/PluginConfigValidator.js";
import { resolve_plugin_binding_resources } from "@/city/process/plugin/PluginResourceService.js";
import { load_plugin_types } from "@/city/runtime/plugins/PluginTypeLoader.js";
import type { AgentPluginBinding } from "@/city/types/plugin/AgentPluginBinding.js";
import type { PluginType } from "@/city/types/plugin/PluginInstallation.js";
import type { PluginTypeLoadContext } from "@/city/runtime/plugins/PluginTypeLoader.js";

/** 为一个 Agent 实例化全部已启用的 Plugin。 */
export async function assemble_plugins(input: {
  /** 当前 Agent 的全部 Plugin Binding。 */
  bindings: AgentPluginBinding[];

  /** 内建 Plugin constructor 加载时可用的 City 宿主依赖。 */
  context?: PluginTypeLoadContext;
}): Promise<Plugin[]> {
  const loaded_types = new Map<string, PluginType[]>();
  const plugins: Plugin[] = [];
  for (const binding of input.bindings) {
    if (!binding.enabled) continue;
    const catalog_item = get_plugin_catalog_item(binding.plugin_name);
    if (!catalog_item) throw new Error(`Plugin not found: ${binding.plugin_name}`);
    validate_plugin_config(binding.config, catalog_item.config_schema);

    const installation_key = catalog_item.installation_id ?? "builtin";
    let plugin_types = loaded_types.get(installation_key);
    if (!plugin_types) {
      plugin_types = await load_plugin_types(binding.plugin_name, input.context);
      loaded_types.set(installation_key, plugin_types);
    }
    const plugin_type = plugin_types.find((item) =>
      item.manifest.name === binding.plugin_name
    );
    if (!plugin_type) throw new Error(`Plugin constructor not found: ${binding.plugin_name}`);
    const resources = resolve_plugin_binding_resources(
      binding,
      catalog_item.resource_schema,
    );
    const plugin = new plugin_type({ config: binding.config, resources });
    if (!plugin || typeof plugin !== "object" || plugin.name !== binding.plugin_name) {
      throw new Error(
        `Plugin constructor name mismatch: expected ${binding.plugin_name}, received ${plugin?.name}`,
      );
    }
    plugins.push(plugin);
  }
  return plugins;
}
