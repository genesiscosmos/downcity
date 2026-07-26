/**
 * City Plugin 仓储业务层。
 *
 * 关键点（中文）
 * - 全局安装记录描述 Plugin 制品，Agent Binding 描述启用状态与配置。
 * - 所有写入都校验 Agent 与 Plugin 是否存在，避免产生孤立配置。
 * - 内建 Plugin 不需要安装记录，但与第三方 Plugin 使用相同 Binding 模型。
 */

import { withPlatformStore } from "@/city/runtime/store/index.js";
import {
  get_agent_plugin_row,
  get_installed_plugin_row,
  list_agent_plugin_rows,
  list_installed_plugin_rows,
  remove_agent_plugin_row,
  remove_installed_plugin_row,
  set_agent_plugin_row,
  set_installed_plugin_row,
} from "@/city/runtime/store/StorePluginRepository.js";
import { get_managed_agent } from "@/city/process/registry/ManagedAgentRepository.js";
import type { AgentPluginBinding, SetAgentPluginBindingInput } from "@/city/types/plugin/AgentPluginBinding.js";
import type { InstalledPlugin } from "@/city/types/plugin/PluginManifest.js";
import { validate_plugin_config } from "@/city/process/plugin/PluginConfigValidator.js";
import {
  CITY_BUILTIN_PLUGIN_CONFIGS,
  get_builtin_plugin_config,
} from "@/city/process/plugin/BuiltinPluginConfig.js";

/** City 默认向新 Agent 启用的内建 Plugin 名称。 */
export const DEFAULT_BUILTIN_PLUGIN_NAMES = CITY_BUILTIN_PLUGIN_CONFIGS
  .map((item) => item.plugin_name);

/** 规范化 Plugin 稳定名称。 */
export function normalize_plugin_name(input: string): string {
  const plugin_name = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(plugin_name)) {
    throw new Error(`Invalid plugin name: ${input}`);
  }
  return plugin_name;
}

/** 判断名称是否属于 City 内建 Plugin。 */
export function is_builtin_plugin(plugin_name_input: string): boolean {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  return DEFAULT_BUILTIN_PLUGIN_NAMES.includes(plugin_name);
}

/** 列出全部第三方已安装 Plugin。 */
export function list_installed_plugins(): InstalledPlugin[] {
  return withPlatformStore((context) => list_installed_plugin_rows(context));
}

/** 读取一个第三方已安装 Plugin。 */
export function get_installed_plugin(plugin_name_input: string): InstalledPlugin | null {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  return withPlatformStore((context) => get_installed_plugin_row(context, plugin_name));
}

/** 写入完整的第三方 Plugin 安装记录。 */
export function save_installed_plugin(plugin: InstalledPlugin): InstalledPlugin {
  const plugin_name = normalize_plugin_name(plugin.plugin_name);
  const normalized: InstalledPlugin = {
    ...plugin,
    plugin_name,
    manifest: { ...plugin.manifest, name: plugin_name },
  };
  withPlatformStore((context) => set_installed_plugin_row(context, normalized));
  return normalized;
}

/** 删除未被任何 Agent 绑定的第三方 Plugin 安装记录。 */
export function remove_installed_plugin(plugin_name_input: string): void {
  const plugin_name = normalize_plugin_name(plugin_name_input);
  withPlatformStore((context) => {
    const binding = context.sqlite.prepare(
      "SELECT agent_id FROM agent_plugins WHERE plugin_name = ? LIMIT 1;",
    ).get(plugin_name) as { agent_id: string } | undefined;
    if (binding) {
      throw new Error(
        `Plugin is still bound to agent ${binding.agent_id}: ${plugin_name}`,
      );
    }
    remove_installed_plugin_row(context, plugin_name);
  });
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
  if (!is_builtin_plugin(plugin_name) && !get_installed_plugin(plugin_name)) {
    throw new Error(`Plugin is not installed: ${plugin_name}`);
  }
  const builtin_config = get_builtin_plugin_config(plugin_name);
  const installed_plugin = builtin_config ? null : get_installed_plugin(plugin_name);
  validate_plugin_config(
    input.config,
    builtin_config?.config_schema ?? installed_plugin?.manifest.config_schema,
  );
  const existing = withPlatformStore((context) =>
    get_agent_plugin_row(context, agent_id, plugin_name)
  );
  const current_time = new Date().toISOString();
  const binding: AgentPluginBinding = {
    agent_id,
    plugin_name,
    enabled: input.enabled,
    config: input.config,
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

/** 为新 Agent 创建默认内建 Plugin Binding。 */
export function ensure_default_agent_plugin_bindings(
  agent_id: string,
  initial_configs: Readonly<Record<string, import("@downcity/agent").JsonObject | undefined>> = {},
): void {
  for (const plugin_name of DEFAULT_BUILTIN_PLUGIN_NAMES) {
    if (get_agent_plugin_binding(agent_id, plugin_name)) continue;
    set_agent_plugin_binding({
      agent_id,
      plugin_name,
      enabled: true,
      config: initial_configs[plugin_name]
        ?? get_builtin_plugin_config(plugin_name)?.default_config
        ?? {},
    });
  }
}
