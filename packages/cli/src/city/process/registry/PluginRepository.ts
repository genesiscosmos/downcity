/**
 * City Plugin 内部安装记录与 Agent Plugin Binding 业务仓储。
 *
 * 关键点（中文）
 * - Plugin 是 Catalog、Binding、Config 与 Resource 的唯一公开单位。
 * - installation 只管理多个 Plugin 共享的来源、入口和文件生命周期。
 * - 所有写入都校验 Agent、Plugin、配置与 Resource，避免产生孤立状态。
 */

import {
  normalize_installation_id,
  normalize_plugin_name as normalize_local_plugin_name,
} from "@downcity/local";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import { create_cli_builtin_plugin_types } from "@/city/runtime/AgentAssembly.js";
import { get_plugin_catalog_item } from "@/city/process/plugin/PluginCatalog.js";
import type {
  AgentPluginBinding,
  SetAgentPluginBindingInput,
} from "@/city/types/plugin/AgentPluginBinding.js";
import type {
  InstalledPluginInstallation,
  InstalledPluginReference,
} from "@/city/types/plugin/PluginInstallation.js";
import { validate_plugin_config } from "@/city/process/plugin/PluginConfigValidator.js";
import { get_plugin_resource } from "@/city/process/registry/PluginResourceRepository.js";
import { validate_plugin_resource_item } from "@/city/process/plugin/PluginResourceSchema.js";

/** City 导出的全部内建 Plugin 名称。 */
export const BUILTIN_PLUGIN_NAMES = Object.freeze(
  create_cli_builtin_plugin_types().map((plugin_type) => plugin_type.manifest.name),
);

/** 规范化 Plugin 稳定名称。 */
export function normalize_plugin_name(input: string): string {
  return normalize_local_plugin_name(input);
}

/** 规范化内部 installation ID。 */
export function normalize_plugin_installation_id(input: string): string {
  return normalize_installation_id(input);
}

/** 判断 Plugin 是否由 City 内建数组导出。 */
export function is_builtin_plugin(plugin_name_input: string): boolean {
  return BUILTIN_PLUGIN_NAMES.includes(normalize_plugin_name(plugin_name_input));
}

/** 列出全部第三方 Plugin 内部安装记录。 */
export function list_plugin_installations(): InstalledPluginInstallation[] {
  return with_cli_local_data((data) => data.plugins.list_installations());
}

/** 按内部 ID 读取一个 Plugin 安装记录。 */
export function get_plugin_installation(
  installation_id_input: string,
): InstalledPluginInstallation | null {
  const installation_id = normalize_plugin_installation_id(installation_id_input);
  return with_cli_local_data((data) => data.plugins.get_installation(installation_id));
}

/** 按公开 Plugin 名称定位第三方安装记录与 Manifest。 */
export function get_installed_plugin(
  plugin_name_input: string,
): InstalledPluginReference | null {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  for (const installation of list_plugin_installations()) {
    const manifest = installation.manifest.plugins
      .find((plugin) => plugin.name === plugin_name);
    if (manifest) return { installation, manifest };
  }
  return null;
}

/** 写入完整的内部 Plugin 安装记录。 */
export function save_plugin_installation(
  installation: InstalledPluginInstallation,
): InstalledPluginInstallation {
  const installation_id = normalize_plugin_installation_id(installation.installation_id);
  const normalized = { ...installation, installation_id };
  return with_cli_local_data((data) => data.plugins.save_installation(normalized));
}

/** 删除 Plugin 所属的共享 installation；任一兄弟 Plugin 被使用时拒绝。 */
export function remove_plugin_installation(plugin_name_input: string): InstalledPluginInstallation {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  const reference = get_installed_plugin(plugin_name);
  if (!reference) throw new Error(`Plugin is not installed: ${plugin_name}`);
  return with_cli_local_data((data) =>
    data.plugins.remove_installation(reference.installation.installation_id)
  );
}

/** 列出一个 Agent 的全部 Plugin Binding。 */
export function list_agent_plugin_bindings(agent_id_input: string): AgentPluginBinding[] {
  const agent_id = String(agent_id_input || "").trim();
  return with_cli_local_data((data) => data.plugins.list_agent_bindings(agent_id)) as AgentPluginBinding[];
}

/** 读取一个 Agent 的指定 Plugin Binding。 */
export function get_agent_plugin_binding(
  agent_id_input: string,
  plugin_name_input: string,
): AgentPluginBinding | null {
  const agent_id = String(agent_id_input || "").trim();
  const plugin_name = normalize_plugin_name(plugin_name_input);
  return with_cli_local_data((data) => data.plugins.get_agent_binding(agent_id, plugin_name)) as AgentPluginBinding | null;
}

/** 新建或更新一个 Agent Plugin Binding。 */
export function set_agent_plugin_binding(
  input: SetAgentPluginBindingInput,
): AgentPluginBinding {
  const agent_id = String(input.agent_id || "").trim();
  const plugin_name = normalize_plugin_name(input.plugin_name);
  const plugin = get_plugin_catalog_item(plugin_name);
  if (!plugin) throw new Error(`Plugin is not installed: ${plugin_name}`);
  validate_plugin_config(input.config, plugin.config_schema);

  const resource_ids = normalize_resource_ids(input.resource_ids ?? []);
  if (!plugin.resource_schema && resource_ids.length > 0) {
    throw new Error(`Plugin does not declare Resources: ${plugin_name}`);
  }
  if (plugin.resource_schema) {
    const resource_schema = plugin.resource_schema;
    for (const resource_id of resource_ids) {
      const resource = get_plugin_resource(plugin_name, resource_id);
      if (!resource) throw new Error(`Plugin Resource not found: ${plugin_name}/${resource_id}`);
      validate_plugin_resource_item(resource.item, resource_schema);
    }
  }
  return with_cli_local_data((data) => data.plugins.save_agent_binding({
    agent_id,
    plugin_name,
    enabled: input.enabled,
    config: input.config,
    resource_ids,
  })) as AgentPluginBinding;
}

/** 删除一个 Agent Plugin Binding。 */
export function remove_agent_plugin_binding(
  agent_id_input: string,
  plugin_name_input: string,
): void {
  const agent_id = String(agent_id_input || "").trim();
  const plugin_name = normalize_plugin_name(plugin_name_input);
  with_cli_local_data((data) => data.plugins.remove_agent_binding(agent_id, plugin_name));
}

/** 规范化并去重 Binding Resource ID。 */
function normalize_resource_ids(input: string[]): string[] {
  const resource_ids = input.map((item) => String(item || "").trim()).filter(Boolean);
  const unique_ids = [...new Set(resource_ids)];
  if (unique_ids.length !== resource_ids.length) {
    throw new Error("Plugin Binding resource_ids must be unique");
  }
  for (const resource_id of unique_ids) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(resource_id)) {
      throw new Error(`Invalid Plugin Resource id: ${resource_id}`);
    }
  }
  return unique_ids;
}
