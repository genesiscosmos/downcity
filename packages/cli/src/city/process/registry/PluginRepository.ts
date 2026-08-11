/**
 * City Plugin 内部安装记录与 Agent Plugin Binding 业务仓储。
 *
 * 关键点（中文）
 * - Plugin 是 Catalog、Binding、Config 与 Resource 的唯一公开单位。
 * - installation 只管理多个 Plugin 共享的来源、入口和文件生命周期。
 * - 所有写入都校验 Agent、Plugin、配置与 Resource，避免产生孤立状态。
 */

import { withPlatformStore } from "@/city/runtime/store/index.js";
import {
  get_agent_plugin_row,
  get_plugin_installation_row,
  list_agent_plugin_rows,
  list_plugin_installation_rows,
  remove_agent_plugin_row,
  remove_plugin_installation_row,
  set_agent_plugin_row,
  set_plugin_installation_row,
} from "@/city/runtime/store/StorePluginRepository.js";
import { get_managed_agent } from "@/city/process/registry/ManagedAgentRepository.js";
import { get_plugin_catalog_item } from "@/city/process/plugin/PluginCatalog.js";
import { create_downcity_plugin_types } from "@/city/runtime/plugins/DowncityPlugins.js";
import type {
  AgentPluginBinding,
  SetAgentPluginBindingInput,
} from "@/city/types/plugin/AgentPluginBinding.js";
import type {
  InstalledPluginInstallation,
  InstalledPluginReference,
} from "@/city/types/plugin/PluginInstallation.js";
import { validate_plugin_config } from "@/city/process/plugin/PluginConfigValidator.js";
import { get_plugin_resource_row } from "@/city/runtime/store/StorePluginResourceRepository.js";
import { validate_plugin_resource_item } from "@/city/process/plugin/PluginResourceSchema.js";

/** City 导出的全部内建 Plugin 名称。 */
export const BUILTIN_PLUGIN_NAMES = Object.freeze(
  create_downcity_plugin_types().map((plugin_type) => plugin_type.manifest.name),
);

/** 规范化 Plugin 稳定名称。 */
export function normalize_plugin_name(input: string): string {
  const plugin_name = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(plugin_name)) {
    throw new Error(`Invalid Plugin name: ${input}`);
  }
  return plugin_name;
}

/** 规范化内部 installation ID。 */
export function normalize_plugin_installation_id(input: string): string {
  const installation_id = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(installation_id)) {
    throw new Error(`Invalid Plugin installation id: ${input}`);
  }
  return installation_id;
}

/** 判断 Plugin 是否由 City 内建数组导出。 */
export function is_builtin_plugin(plugin_name_input: string): boolean {
  return BUILTIN_PLUGIN_NAMES.includes(normalize_plugin_name(plugin_name_input));
}

/** 列出全部第三方 Plugin 内部安装记录。 */
export function list_plugin_installations(): InstalledPluginInstallation[] {
  return withPlatformStore((context) => list_plugin_installation_rows(context));
}

/** 按内部 ID 读取一个 Plugin 安装记录。 */
export function get_plugin_installation(
  installation_id_input: string,
): InstalledPluginInstallation | null {
  const installation_id = normalize_plugin_installation_id(installation_id_input);
  return withPlatformStore((context) =>
    get_plugin_installation_row(context, installation_id)
  );
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
  withPlatformStore((context) => set_plugin_installation_row(context, normalized));
  return normalized;
}

/** 删除 Plugin 所属的共享 installation；任一兄弟 Plugin 被使用时拒绝。 */
export function remove_plugin_installation(plugin_name_input: string): InstalledPluginInstallation {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  const reference = get_installed_plugin(plugin_name);
  if (!reference) throw new Error(`Plugin is not installed: ${plugin_name}`);
  const { installation } = reference;
  withPlatformStore((context) => {
    for (const manifest of installation.manifest.plugins) {
      const binding = context.sqlite.prepare(
        "SELECT agent_id FROM agent_plugins WHERE plugin_name = ? LIMIT 1;",
      ).get(manifest.name) as { agent_id: string } | undefined;
      if (binding) {
        throw new Error(`Plugin is still bound to agent ${binding.agent_id}: ${manifest.name}`);
      }
      const resource = context.sqlite.prepare(
        "SELECT resource_id FROM plugin_resources WHERE plugin_name = ? LIMIT 1;",
      ).get(manifest.name) as { resource_id: string } | undefined;
      if (resource) {
        throw new Error(`Plugin still owns Resource ${resource.resource_id}: ${manifest.name}`);
      }
    }
    remove_plugin_installation_row(context, installation.installation_id);
  });
  return installation;
}

/** 列出一个 Agent 的全部 Plugin Binding。 */
export function list_agent_plugin_bindings(agent_id_input: string): AgentPluginBinding[] {
  const agent_id = String(agent_id_input || "").trim();
  if (!get_managed_agent(agent_id)) throw new Error(`Agent not found: ${agent_id}`);
  return withPlatformStore((context) => list_agent_plugin_rows(context, agent_id));
}

/** 读取一个 Agent 的指定 Plugin Binding。 */
export function get_agent_plugin_binding(
  agent_id_input: string,
  plugin_name_input: string,
): AgentPluginBinding | null {
  const agent_id = String(agent_id_input || "").trim();
  const plugin_name = normalize_plugin_name(plugin_name_input);
  if (!get_managed_agent(agent_id)) throw new Error(`Agent not found: ${agent_id}`);
  return withPlatformStore((context) => get_agent_plugin_row(context, agent_id, plugin_name));
}

/** 新建或更新一个 Agent Plugin Binding。 */
export function set_agent_plugin_binding(
  input: SetAgentPluginBindingInput,
): AgentPluginBinding {
  const agent_id = String(input.agent_id || "").trim();
  const plugin_name = normalize_plugin_name(input.plugin_name);
  if (!get_managed_agent(agent_id)) throw new Error(`Agent not found: ${agent_id}`);
  const plugin = get_plugin_catalog_item(plugin_name);
  if (!plugin) throw new Error(`Plugin is not installed: ${plugin_name}`);
  validate_plugin_config(input.config, plugin.config_schema);

  const resource_ids = normalize_resource_ids(input.resource_ids ?? []);
  if (!plugin.resource_schema && resource_ids.length > 0) {
    throw new Error(`Plugin does not declare Resources: ${plugin_name}`);
  }
  if (plugin.resource_schema) {
    const resource_schema = plugin.resource_schema;
    withPlatformStore((context) => {
      for (const resource_id of resource_ids) {
        const resource = get_plugin_resource_row(context, plugin_name, resource_id);
        if (!resource) throw new Error(`Plugin Resource not found: ${plugin_name}/${resource_id}`);
        validate_plugin_resource_item(resource.item, resource_schema);
      }
    });
  }

  const existing = withPlatformStore((context) =>
    get_agent_plugin_row(context, agent_id, plugin_name)
  );
  const current_time = new Date().toISOString();
  const binding: AgentPluginBinding = {
    agent_id,
    plugin_name,
    enabled: input.enabled,
    config: input.config,
    resource_ids,
    created_at: existing?.created_at ?? current_time,
    updated_at: current_time,
  };
  withPlatformStore((context) => set_agent_plugin_row(context, binding));
  return binding;
}

/** 删除一个 Agent Plugin Binding。 */
export function remove_agent_plugin_binding(
  agent_id_input: string,
  plugin_name_input: string,
): void {
  const agent_id = String(agent_id_input || "").trim();
  const plugin_name = normalize_plugin_name(plugin_name_input);
  withPlatformStore((context) => remove_agent_plugin_row(context, agent_id, plugin_name));
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
