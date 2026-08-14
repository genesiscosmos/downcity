/**
 * City Plugin Catalog 与 Agent Binding 的交互式管理器。
 *
 * 关键点（中文）
 * - 全局入口负责安装制品并选择 Agent；Agent 内入口直接管理当前 Binding。
 * - 所有配置交互由 JSON Schema 表单生成，不包含 Chat 或 channel 分支。
 */

import fs from "fs-extra";
import prompts from "@/city/tui/Prompts.js";
import { list_agent_configs } from "@/city/process/registry/AgentConfigRepository.js";
import {
  get_agent_plugin_binding,
  remove_agent_plugin_binding,
  remove_plugin_installation,
  set_agent_plugin_binding,
} from "@/city/process/registry/PluginRepository.js";
import { get_plugin_installation_dir_path } from "@/city/process/registry/CityPaths.js";
import {
  get_plugin_catalog_item,
  list_plugin_catalog,
} from "@/city/process/plugin/PluginCatalog.js";
import {
  install_plugins,
  update_plugin,
} from "@/city/process/plugin/PluginInstaller.js";
import { prompt_and_save_plugin_binding } from "@/city/process/plugin/PluginBindingConfiguration.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";
import {
  run_interactive_binding_resources,
  run_interactive_plugin_resource_manager,
} from "@/city/process/plugin/InteractivePluginResourceManager.js";

/** 打开 City 全局 Plugin 管理器。 */
export async function run_interactive_plugin_manager(): Promise<void> {
  while (true) {
    const catalog = list_plugin_catalog();
    const response = await prompts({
      type: "select",
      name: "selection",
      message: "Plugins",
      choices: [
        ...catalog.map((plugin) => ({
          title: plugin.title,
          description: [
            plugin.description,
            plugin.plugin_name,
            plugin.source,
            plugin.version,
          ].filter(Boolean).join(" · "),
          value: `plugin:${plugin.plugin_name}`,
        })),
        { title: "操作", disabled: true },
        {
          title: "安装 Plugin",
          description: "从本地目录、Git URL 或 github:owner/repo#ref 安装",
          value: "install",
        },
        { title: "返回", description: "回到 City 首页", value: "back" },
      ],
    });
    const selection = String(response.selection || "");
    if (!selection || selection === "back") return;
    if (selection === "install") {
      await run_interactive_install();
      continue;
    }
    const plugin_name = selection.startsWith("plugin:") ? selection.slice(7) : "";
    const plugin = get_plugin_catalog_item(plugin_name);
    if (plugin) await run_interactive_plugin_actions(plugin);
  }
}

/** 打开指定 Agent 的统一 Plugin Binding 管理器。 */
export async function run_interactive_agent_plugin_manager(agent_id: string): Promise<void> {
  while (true) {
    const catalog = list_plugin_catalog();
    const response = await prompts({
      type: "select",
      name: "plugin_name",
      message: `Agent Plugins · ${agent_id}`,
      choices: [
        ...catalog.map((plugin) => {
          const binding = get_agent_plugin_binding(agent_id, plugin.plugin_name);
          const binding_status = binding
            ? (binding.enabled ? "enabled" : "disabled")
            : "not bound";
          return {
            title: `${binding?.enabled ? "●" : "○"} ${plugin.title}`,
            description: `${plugin.description} · ${plugin.plugin_name} · ${binding_status}`,
            value: plugin.plugin_name,
          };
        }),
        { title: "返回", description: "返回 Agent 配置", value: "back" },
      ],
    });
    const plugin_name = String(response.plugin_name || "");
    if (!plugin_name || plugin_name === "back") return;
    const plugin = get_plugin_catalog_item(plugin_name);
    if (plugin) await run_agent_binding_actions(plugin, agent_id);
  }
}

/** 管理一个 Catalog Plugin 的全局动作。 */
async function run_interactive_plugin_actions(plugin: PluginCatalogItem): Promise<void> {
  const response = await prompts({
    type: "select",
    name: "action",
    message: plugin.title,
    subtitle: plugin.description || plugin.plugin_name,
    choices: [
      { title: "绑定或配置 Agent", description: "选择 Agent 并进入统一配置表单", value: "bind" },
      ...(plugin.resource_schema
        ? [{
            title: "管理 Resources",
            description: "创建、编辑、刷新或删除完整 Plugin Resource",
            value: "resources",
          }]
        : []),
      ...(plugin.source === "installed"
        ? [
            { title: "更新", description: "从已保存来源重新安装", value: "update" },
            { title: "卸载", description: "删除未被 Agent Binding 使用的制品", value: "uninstall" },
          ]
        : []),
      { title: "返回", description: "返回 Agent Plugin 列表", value: "back" },
    ],
  });
  if (response.action === "bind") {
    const agent_id = await prompt_agent_id();
    if (agent_id) await run_agent_binding_actions(plugin, agent_id);
    return;
  }
  if (response.action === "resources") {
    await run_interactive_plugin_resource_manager(plugin);
    return;
  }
  if (response.action === "update") {
    const installation = await update_plugin(plugin.plugin_name);
    emitCliBlock({
      tone: "success",
      title: "Plugins updated",
      summary: installation.manifest.plugins.map((item) => item.name).join(", "),
    });
    return;
  }
  if (response.action === "uninstall") {
    const confirmed = await prompts({
      type: "confirm",
      name: "confirmed",
      message: `卸载与 ${plugin.plugin_name} 共享入口的全部 Plugin？`,
      initial: false,
    });
    if (confirmed.confirmed !== true) return;
    const installation = remove_plugin_installation(plugin.plugin_name);
    await fs.remove(get_plugin_installation_dir_path(installation.installation_id));
    emitCliBlock({
      tone: "success",
      title: "Plugins uninstalled",
      summary: installation.manifest.plugins.map((item) => item.name).join(", "),
    });
  }
}

/** 管理一个 Agent 的指定 Plugin Binding。 */
async function run_agent_binding_actions(plugin: PluginCatalogItem, agent_id: string): Promise<void> {
  const binding = get_agent_plugin_binding(agent_id, plugin.plugin_name);
  const response = await prompts({
    type: "select",
    name: "action",
    message: `${plugin.title} · ${agent_id}`,
    subtitle: binding ? (binding.enabled ? "enabled" : "disabled") : "not bound",
    choices: [
      {
        title: binding ? "配置" : "启用并配置",
        description: plugin.config_schema ? "使用 Plugin Schema 编辑完整配置" : "该 Plugin 没有配置字段",
        value: "configure",
      },
      ...(plugin.resource_schema
        ? [{
            title: "Resources",
            description: "创建并选择该 Plugin 实例使用的 Resource",
            value: "resources",
          }]
        : []),
      ...(binding
        ? [{
            title: binding.enabled ? "禁用" : "启用",
            description: "修改下次 Agent 装配时的启用状态",
            value: "toggle",
          }]
        : []),
      ...(binding
        ? [{ title: "删除 Binding", description: "删除当前 Agent 的配置与启用关系", value: "remove" }]
        : []),
      { title: "返回", description: "返回 Plugin 列表", value: "back" },
    ],
  });
  if (response.action === "configure") {
    const saved = await prompt_and_save_plugin_binding({
      agent_id,
      plugin,
      enabled: binding?.enabled ?? true,
    });
    if (saved) emit_binding_saved(saved.plugin_name, saved.agent_id, saved.enabled);
    return;
  }
  if (response.action === "resources") {
    await run_interactive_binding_resources(plugin, agent_id);
    return;
  }
  if (response.action === "toggle" && binding) {
    const saved = set_agent_plugin_binding({ ...binding, enabled: !binding.enabled });
    emit_binding_saved(saved.plugin_name, saved.agent_id, saved.enabled);
    return;
  }
  if (response.action === "remove" && binding) {
    remove_agent_plugin_binding(agent_id, plugin.plugin_name);
    emitCliBlock({ tone: "success", title: "Plugin binding removed", summary: plugin.plugin_name });
  }
}

/** 安装一个用户显式信任的静态 Plugin 制品。 */
async function run_interactive_install(): Promise<void> {
  const source_response = await prompts({
    type: "text",
    name: "source",
    message: "Plugin 来源",
    subtitle: "本地目录、Git URL 或 github:owner/repo#ref",
  });
  const source = String(source_response.source || "").trim();
  if (!source) return;
  const trust_response = await prompts({
    type: "confirm",
    name: "trusted",
    message: "信任该 Plugin 来源并允许它在 Agent 进程内执行？",
    initial: false,
  });
  if (trust_response.trusted !== true) return;
  const installation = await install_plugins(source);
  emitCliBlock({
    tone: "success",
    title: "Plugins installed",
    summary: installation.manifest.plugins.map((item) => item.name).join(", "),
    facts: [
      { label: "Integrity", value: installation.integrity },
      ...(installation.resolved_commit
        ? [{ label: "Commit", value: installation.resolved_commit }]
        : []),
    ],
  });
}

/** 选择一个已登记 Agent。 */
async function prompt_agent_id(): Promise<string | null> {
  const agents = list_agent_configs();
  if (agents.length === 0) {
    emitCliBlock({ tone: "info", title: "No registered Agents" });
    return null;
  }
  const response = await prompts({
    type: "select",
    name: "agent_id",
    message: "选择 Agent",
    choices: agents.map((agent) => ({
      title: agent.agent_id,
      value: agent.agent_id,
    })),
  });
  return String(response.agent_id || "").trim() || null;
}

/** 输出 Binding 保存结果和明确生效检查点。 */
function emit_binding_saved(plugin_name: string, agent_id: string, enabled: boolean): void {
  emitCliBlock({
    tone: "success",
    title: "Plugin binding saved",
    summary: `${plugin_name} · ${agent_id} · ${enabled ? "enabled" : "disabled"}`,
    note: "新的 Plugin 装配会在下次 City 装配 Agent 时生效。",
  });
}
