/**
 * Agent Plugin Binding 的通用交互配置入口。
 *
 * 关键点（中文）
 * - 内建与外部 Plugin 都使用 Catalog Schema 和同一个表单。
 * - 保存只发生在完整草稿校验通过后，不产生半配置 Binding。
 */

import { get_agent_plugin_binding, set_agent_plugin_binding } from "@/city/process/registry/PluginRepository.js";
import { prompt_plugin_config } from "@/city/process/plugin/PluginConfigForm.js";
import type { AgentPluginBinding } from "@/city/types/plugin/AgentPluginBinding.js";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";

/** 交互配置并保存一个 Agent Plugin Binding。 */
export async function prompt_and_save_plugin_binding(input: {
  /** 目标 Agent ID。 */
  agent_id: string;

  /** 统一 Catalog 中的 Plugin 目录项。 */
  plugin: PluginCatalogItem;

  /** 保存后的启用状态。 */
  enabled: boolean;
}): Promise<AgentPluginBinding | null> {
  const existing = get_agent_plugin_binding(input.agent_id, input.plugin.plugin_name);
  const current_config = existing?.config ?? input.plugin.default_config;
  const config = input.plugin.config_schema
    ? await prompt_plugin_config({
        plugin_name: input.plugin.plugin_name,
        schema: input.plugin.config_schema,
        current_config,
      })
    : current_config;
  if (!config) return null;
  return set_agent_plugin_binding({
    agent_id: input.agent_id,
    plugin_name: input.plugin.plugin_name,
    enabled: input.enabled,
    config,
    resource_ids: existing?.resource_ids ?? [],
  });
}
