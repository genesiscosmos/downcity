/** City Plugin 的交互式制品管理器。 */

import prompts from "@/city/tui/Prompts.js";
import {
  remove_installed_plugin,
} from "@/city/process/registry/PluginRepository.js";
import {
  resolve_plugin_catalog_item,
  list_plugin_catalog,
} from "@/city/process/plugin/PluginCatalog.js";
import { install_plugin, update_plugin } from "@/city/process/plugin/PluginInstaller.js";
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

/** 管理一个 Plugin 的全局配置与制品。 */
async function run_interactive_plugin_actions(plugin: PluginCatalogItem): Promise<void> {
  const response = await prompts({
    type: "select",
    name: "action",
    message: plugin.title,
    subtitle: plugin.description,
    choices: [
      ...(plugin.has_config ? [{ title: "配置说明", description: "在 Desktop Plugin 页面编辑唯一配置", value: "config" }] : []),
      ...(plugin.source === "installed"
        ? [
            { title: "更新", description: "从已保存来源更新 Plugin", value: "update" },
            { title: "卸载", description: "删除本地 Plugin 制品", value: "uninstall" },
          ]
        : []),
      { title: "返回", value: "back" },
    ],
  });
  if (response.action === "config") {
    emitCliBlock({
      tone: "info",
      title: "Plugin config",
      summary: plugin.plugin_id,
      note: "请在 Downcity Desktop 的 Plugin 页面编辑配置，或使用 downcity plugin config --set。",
    });
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
