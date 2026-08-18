/**
 * City Plugin、Profile 与 Agent 引用业务仓储。
 *
 * Plugin 的代码和配置全部位于 `plugins/<plugin_id>/`；Agent 是否注册 Plugin 只由
 * 自己的 `agent.json` 决定，不存在独立 Binding 或 Resource 表。
 */

import {
  normalize_plugin_id as normalize_local_plugin_id,
  normalize_profile_id,
  type LocalInstalledPluginDefinition,
} from "@downcity/local/product";
import type { JsonObject } from "@downcity/agent";
import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import { create_cli_builtin_plugin_registrations } from "@/city/runtime/AgentAssembly.js";
import {
  list_plugin_catalog,
  resolve_plugin_catalog_item,
} from "@/city/process/plugin/PluginCatalog.js";
import { validate_local_plugin_config } from "@downcity/local/product";
import type {
  AgentPluginReference,
  SetAgentPluginReferenceInput,
} from "@/city/types/plugin/AgentPluginReference.js";

/** City 导出的全部内建 Plugin ID。 */
export const BUILTIN_PLUGIN_IDS = Object.freeze(
  create_cli_builtin_plugin_registrations().map((registration) => registration.definition.id),
);

/** 规范化 Plugin 稳定 ID。 */
export function normalize_plugin_id(input: string): string {
  return normalize_local_plugin_id(input);
}

/** 判断 Plugin 是否由 City 内建数组导出。 */
export function is_builtin_plugin(plugin_id_input: string): boolean {
  return BUILTIN_PLUGIN_IDS.includes(normalize_plugin_id(plugin_id_input));
}

/** 列出全部第三方 Plugin。 */
export function list_installed_plugins(): LocalInstalledPluginDefinition[] {
  return with_cli_local_data((data) => data.plugins.list_installed());
}

/** 读取指定第三方 Plugin。 */
export function get_installed_plugin(plugin_id_input: string): LocalInstalledPluginDefinition | null {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  return with_cli_local_data((data) => data.plugins.get_installed(plugin_id));
}

/** 删除一个没有 Agent 引用的第三方 Plugin 目录。 */
export function remove_installed_plugin(plugin_id_input: string): LocalInstalledPluginDefinition {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  if (is_builtin_plugin(plugin_id)) throw new Error("Builtin Plugins cannot be uninstalled");
  const installed = get_installed_plugin(plugin_id);
  if (!installed) throw new Error(`Plugin is not installed: ${plugin_id}`);
  const reference = find_plugin_reference(plugin_id);
  if (reference) {
    throw new Error(`Plugin is still registered by Agent ${reference.agent_id}: ${plugin_id}`);
  }
  with_cli_local_data((data) => data.plugins.remove_installed(plugin_id));
  return installed;
}

/** 列出一个 Agent 注册的全部 Plugin。 */
export function list_agent_plugin_references(agent_id_input: string): AgentPluginReference[] {
  const agent_id = String(agent_id_input || "").trim();
  return with_cli_local_data((data) => {
    const agent = data.agents.get(agent_id);
    if (!agent) throw new Error(`Agent not found: ${agent_id}`);
    return Object.entries(agent.plugins).map(([plugin_id, reference]) => ({
      agent_id,
      plugin_id,
      ...(reference.profile ? { profile: reference.profile } : {}),
    }));
  });
}

/** 读取一个 Agent 的指定 Plugin 引用。 */
export function get_agent_plugin_reference(
  agent_id_input: string,
  plugin_id_input: string,
): AgentPluginReference | null {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  return list_agent_plugin_references(agent_id_input)
    .find((item) => item.plugin_id === plugin_id) ?? null;
}

/** 注册 Plugin 或切换 Agent 使用的 profile。 */
export function set_agent_plugin_reference(
  input: SetAgentPluginReferenceInput,
): AgentPluginReference {
  const agent_id = String(input.agent_id || "").trim();
  const plugin_id = normalize_plugin_id(input.plugin_id);
  const plugin = list_plugin_catalog().find((item) => item.plugin_id === plugin_id);
  if (!plugin) throw new Error(`Plugin not found: ${plugin_id}`);
  const profile = String(input.profile || "").trim();
  if (profile) {
    normalize_profile_id(profile);
    const exists = with_cli_local_data((data) => data.plugins.get_profile(plugin_id, profile));
    if (!exists) throw new Error(`Plugin profile not found: ${plugin_id}/${profile}`);
  }
  with_cli_local_data((data) => {
    data.agents.set_plugin(agent_id, plugin_id, profile ? { profile } : {});
  });
  return { agent_id, plugin_id, ...(profile ? { profile } : {}) };
}

/** 从 Agent 定义中注销一个 Plugin。 */
export function remove_agent_plugin_reference(
  agent_id_input: string,
  plugin_id_input: string,
): void {
  const agent_id = String(agent_id_input || "").trim();
  const plugin_id = normalize_plugin_id(plugin_id_input);
  with_cli_local_data((data) => data.agents.remove_plugin(agent_id, plugin_id));
}

/** 列出 Plugin 的全部 profile ID。 */
export function list_plugin_profiles(plugin_id_input: string): string[] {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  return with_cli_local_data((data) =>
    Object.keys(data.plugins.read_config(plugin_id).profiles).sort(),
  );
}

/** 读取一个 Plugin profile。 */
export function get_plugin_profile(
  plugin_id_input: string,
  profile_input: string,
): JsonObject | null {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  const profile = normalize_profile_id(profile_input);
  return with_cli_local_data((data) => data.plugins.get_profile(plugin_id, profile));
}

/** 校验并保存一个 Plugin profile。 */
export async function save_plugin_profile(
  plugin_id_input: string,
  profile_input: string,
  config: JsonObject,
): Promise<JsonObject> {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  const profile = normalize_profile_id(profile_input);
  const plugin = await resolve_plugin_catalog_item(plugin_id);
  if (!plugin) throw new Error(`Plugin not found: ${plugin_id}`);
  if (plugin.config_schema) validate_local_plugin_config(config, plugin.config_schema);
  return with_cli_local_data((data) => data.plugins.save_profile(plugin_id, profile, config));
}

/** 删除一个没有 Agent 引用的 Plugin profile。 */
export function remove_plugin_profile(plugin_id_input: string, profile_input: string): void {
  const plugin_id = normalize_plugin_id(plugin_id_input);
  const profile = normalize_profile_id(profile_input);
  const reference = with_cli_local_data((data) => data.agents.list()
    .find((agent) => agent.plugins[plugin_id]?.profile === profile));
  if (reference) {
    throw new Error(`Plugin profile is still used by Agent ${reference.agent_id}: ${plugin_id}/${profile}`);
  }
  with_cli_local_data((data) => data.plugins.remove_profile(plugin_id, profile));
}

/** 查找第一个引用指定 Plugin 的 Agent。 */
function find_plugin_reference(plugin_id: string): AgentPluginReference | undefined {
  return with_cli_local_data((data) => data.agents.list()
    .flatMap((agent) => Object.entries(agent.plugins).map(([id, reference]) => ({
      agent_id: agent.agent_id,
      plugin_id: id,
      ...(reference.profile ? { profile: reference.profile } : {}),
    })))
    .find((reference) => reference.plugin_id === plugin_id));
}
