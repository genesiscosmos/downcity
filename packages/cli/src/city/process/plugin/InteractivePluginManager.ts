/** Plugin、profile 与 Agent 引用的交互式管理器。 */

import prompts from "@/city/tui/Prompts.js";
import { list_agent_configs } from "@/city/process/registry/AgentConfigRepository.js";
import {
  get_agent_plugin_reference,
  get_plugin_profile,
  remove_agent_plugin_reference,
  remove_installed_plugin,
  save_plugin_profile,
  set_agent_plugin_reference,
} from "@/city/process/registry/PluginRepository.js";
import {
  resolve_plugin_catalog_item,
  list_plugin_catalog,
} from "@/city/process/plugin/PluginCatalog.js";
import { install_plugin, update_plugin } from "@/city/process/plugin/PluginInstaller.js";
import { prompt_plugin_config } from "@/city/process/plugin/PluginConfigForm.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import type { PluginCatalogItem } from "@/city/types/plugin/PluginCatalog.js";

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
          description: [plugin.plugin_id, plugin.source, plugin.version].filter(Boolean).join(" · "),
          value: `plugin:${plugin.plugin_id}`,
        })),
        { title: "操作", disabled: true },
        { title: "安装 Plugin", description: "从本地目录、Git URL 或 GitHub 安装", value: "install" },
        { title: "返回", value: "back" },
      ],
    });
    const selection = String(response.selection || "");
    if (!selection || selection === "back") return;
    if (selection === "install") {
      await run_interactive_install();
      continue;
    }
    const plugin_id = selection.startsWith("plugin:") ? selection.slice(7) : "";
    const plugin = await resolve_plugin_catalog_item(plugin_id);
    if (plugin) await run_interactive_plugin_actions(plugin);
  }
}

/** 打开指定 Agent 的 Plugin 引用管理器。 */
export async function run_interactive_agent_plugin_manager(agent_id: string): Promise<void> {
  while (true) {
    const catalog = list_plugin_catalog();
    const response = await prompts({
      type: "select",
      name: "plugin_id",
      message: `Agent Plugins · ${agent_id}`,
      choices: [
        ...catalog.map((plugin) => {
          const reference = get_agent_plugin_reference(agent_id, plugin.plugin_id);
          return {
            title: `${reference ? "●" : "○"} ${plugin.title}`,
            description: [plugin.plugin_id, reference?.profile].filter(Boolean).join(" · "),
            value: plugin.plugin_id,
          };
        }),
        { title: "返回", value: "back" },
      ],
    });
    const plugin_id = String(response.plugin_id || "");
    if (!plugin_id || plugin_id === "back") return;
    const plugin = await resolve_plugin_catalog_item(plugin_id);
    if (plugin) await run_agent_plugin_actions(plugin, agent_id);
  }
}

/** 管理一个 Plugin 的全局配置与制品。 */
async function run_interactive_plugin_actions(plugin: PluginCatalogItem): Promise<void> {
  const response = await prompts({
    type: "select",
    name: "action",
    message: plugin.title,
    subtitle: plugin.description,
    choices: [
      { title: "配置 profile", description: "编辑 Plugin 自己的 config.toml", value: "profile" },
      { title: "注册到 Agent", description: "选择 Agent 和 profile", value: "agent" },
      ...(plugin.source === "installed"
        ? [
            { title: "更新", description: "从已保存来源更新 Plugin", value: "update" },
            { title: "卸载", description: "删除未被 Agent 引用的 Plugin", value: "uninstall" },
          ]
        : []),
      { title: "返回", value: "back" },
    ],
  });
  if (response.action === "profile") await configure_profile(plugin);
  if (response.action === "agent") {
    const agent_id = await prompt_agent_id();
    if (agent_id) await run_agent_plugin_actions(plugin, agent_id);
  }
  if (response.action === "update") {
    const installed = await update_plugin(plugin.plugin_id);
    emitCliBlock({ tone: "success", title: "Plugin updated", summary: installed.id });
  }
  if (response.action === "uninstall") {
    const confirmed = await prompts({
      type: "confirm",
      name: "confirmed",
      message: `卸载 ${plugin.plugin_id}？`,
      initial: false,
    });
    if (confirmed.confirmed === true) {
      const removed = remove_installed_plugin(plugin.plugin_id);
      emitCliBlock({ tone: "success", title: "Plugin uninstalled", summary: removed.id });
    }
  }
}

/** 注册、切换 profile 或注销 Agent Plugin。 */
async function run_agent_plugin_actions(
  plugin: PluginCatalogItem,
  agent_id: string,
): Promise<void> {
  const reference = get_agent_plugin_reference(agent_id, plugin.plugin_id);
  const response = await prompts({
    type: "select",
    name: "action",
    message: `${plugin.title} · ${agent_id}`,
    choices: [
      { title: reference ? "切换 profile" : "启用", value: "enable" },
      { title: "配置 profile", value: "profile" },
      ...(reference ? [{ title: "禁用", value: "disable" }] : []),
      { title: "返回", value: "back" },
    ],
  });
  if (response.action === "profile") await configure_profile(plugin);
  if (response.action === "disable") {
    remove_agent_plugin_reference(agent_id, plugin.plugin_id);
    emitCliBlock({ tone: "success", title: "Plugin disabled", summary: `${plugin.plugin_id} · ${agent_id}` });
  }
  if (response.action === "enable") {
    const profile = await select_profile(plugin);
    if (profile === null) return;
    const saved = set_agent_plugin_reference({
      agent_id,
      plugin_id: plugin.plugin_id,
      ...(profile ? { profile } : {}),
    });
    emitCliBlock({
      tone: "success",
      title: "Plugin enabled",
      summary: `${saved.plugin_id} · ${saved.agent_id}${saved.profile ? ` · ${saved.profile}` : ""}`,
    });
  }
}

/** 通过 Schema 表单编辑一个 profile。 */
async function configure_profile(plugin: PluginCatalogItem): Promise<void> {
  if (!plugin.config_schema) {
    emitCliBlock({ tone: "info", title: "Plugin has no configuration", summary: plugin.plugin_id });
    return;
  }
  const profile_response = await prompts({
    type: "text",
    name: "profile",
    message: "Profile ID",
    initial: plugin.profiles[0] || "default",
  });
  const profile = String(profile_response.profile || "").trim();
  if (!profile) return;
  const existing = get_plugin_profile(plugin.plugin_id, profile);
  const config = await prompt_plugin_config({
    plugin_name: plugin.plugin_id,
    schema: plugin.config_schema,
    current_config: existing ?? plugin.initial_config,
  });
  if (!config) return;
  await save_plugin_profile(plugin.plugin_id, profile, config);
  emitCliBlock({ tone: "success", title: "Plugin profile saved", summary: `${plugin.plugin_id}/${profile}` });
}

/** 根据 schema 对空配置的接受程度选择或创建 profile。 */
async function select_profile(plugin: PluginCatalogItem): Promise<string | null> {
  if (plugin.configuration === "none" || plugin.configuration === "optional") return "";
  if (plugin.profiles.length === 0) {
    await configure_profile(plugin);
    const refreshed = await resolve_plugin_catalog_item(plugin.plugin_id);
    return refreshed?.profiles[0] ?? null;
  }
  const response = await prompts({
    type: "select",
    name: "profile",
    message: "选择 Plugin profile",
    choices: plugin.profiles.map((profile) => ({ title: profile, value: profile })),
  });
  return String(response.profile || "").trim() || null;
}

/** 安装一个用户显式信任的 Plugin。 */
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
    message: "确认信任并安装该 Plugin 代码？",
    initial: false,
  });
  if (trust_response.trusted !== true) return;
  const installed = await install_plugin(source);
  emitCliBlock({ tone: "success", title: "Plugin installed", summary: installed.id });
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
    choices: agents.map((agent) => ({ title: agent.agent_id, value: agent.agent_id })),
  });
  return String(response.agent_id || "").trim() || null;
}
