/**
 * Schema 驱动的 Plugin Resource 交互管理器。
 *
 * 关键点（中文）
 * - 创建和编辑只询问用户可写字段，Resolver 字段由 Plugin 动态写入。
 * - 列表统一使用 `id`、`type`、`name`，不理解任何具体 Resource 类型。
 * - Agent Binding 只选择 Resource ID，完整 Item 在实例化检查点解析。
 */

import prompts from "@/city/tui/Prompts.js";
import { prompt_plugin_resource_fields } from "@/city/process/plugin/PluginConfigForm.js";
import {
  create_plugin_resource,
  refresh_plugin_resource,
  update_plugin_resource,
} from "@/city/process/plugin/PluginResourceService.js";
import {
  list_plugin_resources,
  remove_plugin_resource,
} from "@/city/process/registry/PluginResourceRepository.js";
import {
  get_agent_plugin_binding,
  set_agent_plugin_binding,
} from "@/city/process/registry/PluginRepository.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";
import type { PluginResourceRecord } from "@/city/types/plugin/PluginResource.js";

/** 管理一个 Plugin 的全局 Resource。 */
export async function run_interactive_plugin_resource_manager(
  plugin: PluginCatalogItem,
): Promise<void> {
  if (!plugin.resource_schema) return;
  while (true) {
    const resources = list_plugin_resources(plugin.plugin_name);
    const response = await prompts({
      type: "select",
      name: "selection",
      message: `${plugin.title} Resources`,
      choices: [
        ...resources.map((resource) => ({
          title: resource.item.name,
          description: `${resource.item.type} · ${resource.resource_id}`,
          value: `resource:${resource.resource_id}`,
        })),
        { title: "操作", disabled: true },
        {
          title: "创建 Resource",
          description: "使用 Plugin Resource Schema 创建并解析完整配置",
          value: "create",
        },
        { title: "返回", description: "返回 Plugin 管理", value: "back" },
      ],
    });
    const selection = String(response.selection || "");
    if (!selection || selection === "back") return;
    if (selection === "create") {
      await create_resource_interactively(plugin);
      continue;
    }
    const resource_id = selection.startsWith("resource:") ? selection.slice(9) : "";
    const resource = resources.find((item) => item.resource_id === resource_id);
    if (resource) await run_resource_actions(plugin, resource);
  }
}
/** 管理一个 Agent Binding 对 Resource ID 的选择。 */
export async function run_interactive_binding_resources(
  plugin: PluginCatalogItem,
  agent_id: string,
): Promise<void> {
  if (!plugin.resource_schema) return;
  while (true) {
    const binding = get_agent_plugin_binding(agent_id, plugin.plugin_name);
    const resources = list_plugin_resources(plugin.plugin_name);
    const response = await prompts({
      type: "select",
      name: "action",
      message: `${plugin.title} Resources · ${agent_id}`,
      subtitle: `${binding?.resource_ids.length ?? 0} selected · ${resources.length} available`,
      choices: [
        {
          title: "选择 Resources",
          description: "设置下次 Plugin 实例化需要解析的 Resource ID",
          value: "select",
        },
        {
          title: "创建 Resource",
          description: "创建后可立即绑定到当前 Agent",
          value: "create",
        },
        {
          title: "管理全部 Resources",
          description: "编辑、刷新或删除该 Plugin 的全局 Resource",
          value: "manage",
        },
        { title: "返回", description: "返回 Binding 管理", value: "back" },
      ],
    });
    if (!response.action || response.action === "back") return;
    if (response.action === "manage") {
      await run_interactive_plugin_resource_manager(plugin);
      continue;
    }
    if (response.action === "create") {
      const created = await create_resource_interactively(plugin);
      if (created) {
        const current = get_agent_plugin_binding(agent_id, plugin.plugin_name);
        const resource_ids = [...new Set([...(current?.resource_ids ?? []), created.resource_id])];
        set_agent_plugin_binding({
          agent_id,
          plugin_name: plugin.plugin_name,
          enabled: current?.enabled ?? true,
          config: current?.config ?? plugin.default_config,
          resource_ids,
        });
      }
      continue;
    }
    if (response.action === "select") {
      const selected = await prompts({
        type: "multiselect",
        name: "resource_ids",
        message: `${plugin.title} Resources`,
        choices: resources.map((resource) => ({
          title: resource.item.name,
          description: `${resource.item.type} · ${resource.resource_id}`,
          value: resource.resource_id,
        })),
        initial: binding?.resource_ids ?? [],
      });
      if (!Array.isArray(selected.resource_ids)) continue;
      const resource_ids = selected.resource_ids.map((item) => String(item));
      const saved = set_agent_plugin_binding({
        agent_id,
        plugin_name: plugin.plugin_name,
        enabled: binding?.enabled ?? true,
        config: binding?.config ?? plugin.default_config,
        resource_ids,
      });
      emitCliBlock({
        tone: "success",
        title: "Plugin Resources saved",
        summary: `${saved.plugin_name} · ${saved.agent_id} · ${saved.resource_ids.length} selected`,
        note: "如果 Agent 正在运行，请重启 Agent 以应用新的 Runtime 装配。",
      });
    }
  }
}

/** 使用通用 Schema 表单创建 Resource。 */
async function create_resource_interactively(
  plugin: PluginCatalogItem,
): Promise<PluginResourceRecord | null> {
  if (!plugin.resource_schema) return null;
  const fields = await prompt_plugin_resource_fields({
    plugin_name: plugin.plugin_name,
    schema: plugin.resource_schema,
  });
  if (!fields) return null;
  const created = await create_plugin_resource({
    plugin_name: plugin.plugin_name,
    fields,
  });
  emit_resource_saved("Plugin Resource created", created);
  return created;
}

/** 编辑、刷新或删除单个 Resource。 */
async function run_resource_actions(
  plugin: PluginCatalogItem,
  resource: PluginResourceRecord,
): Promise<void> {
  const response = await prompts({
    type: "select",
    name: "action",
    message: resource.item.name,
    subtitle: `${resource.item.type} · ${resource.resource_id}`,
    choices: [
      { title: "编辑", description: "编辑用户字段并重新执行 Resolver", value: "edit" },
      { title: "刷新", description: "保留用户字段并重新执行 Resolver", value: "refresh" },
      { title: "删除", description: "删除未被 Binding 引用的 Resource", value: "remove" },
      { title: "返回", description: "返回 Resource 列表", value: "back" },
    ],
  });
  if (response.action === "edit" && plugin.resource_schema) {
    const fields = await prompt_plugin_resource_fields({
      plugin_name: plugin.plugin_name,
      schema: plugin.resource_schema,
      current_resource: resource.item,
    });
    if (!fields) return;
    const saved = await update_plugin_resource({
      plugin_name: plugin.plugin_name,
      resource_id: resource.resource_id,
      fields,
    });
    emit_resource_saved("Plugin Resource updated", saved);
    return;
  }
  if (response.action === "refresh") {
    const saved = await refresh_plugin_resource(plugin.plugin_name, resource.resource_id);
    emit_resource_saved("Plugin Resource refreshed", saved);
    return;
  }
  if (response.action === "remove") {
    const confirmation = await prompts({
      type: "confirm",
      name: "confirmed",
      message: `删除 Resource ${resource.item.name}？`,
      initial: false,
    });
    if (confirmation.confirmed !== true) return;
    remove_plugin_resource(plugin.plugin_name, resource.resource_id);
    emitCliBlock({
      tone: "success",
      title: "Plugin Resource removed",
      summary: resource.resource_id,
    });
  }
}

/** 输出 Resource 保存结果。 */
function emit_resource_saved(title: string, resource: PluginResourceRecord): void {
  emitCliBlock({
    tone: "success",
    title,
    summary: `${resource.item.name} · ${resource.resource_id}`,
    facts: [{ label: "Type", value: resource.item.type }],
  });
}
