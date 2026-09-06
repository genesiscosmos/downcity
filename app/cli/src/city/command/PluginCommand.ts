/**
 * `downcity plugin` 命令树。
 *
 * Plugin 以稳定 ID 管理，唯一配置保存于 Plugin 自己的 `config.toml`。
 */

import type { Command } from "commander";
import type { JsonObject, JsonValue } from "@downcity/agent";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import { callServer } from "@/city/process/daemon/Client.js";
import {
  get_installed_plugin,
  get_plugin_config,
  remove_installed_plugin,
  save_plugin_config,
} from "@/city/process/registry/PluginRepository.js";
import { install_plugin, update_plugin } from "@/city/process/plugin/PluginInstaller.js";
import {
  resolve_plugin_catalog_item,
  list_plugin_catalog,
} from "@/city/process/plugin/PluginCatalog.js";
import { run_interactive_plugin_manager } from "@/city/process/plugin/InteractivePluginManager.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { helpText, t } from "@/shared/CliLocale.js";
import { parsePort } from "@/shared/IndexSupport.js";

/** Plugin Action HTTP 返回结构。 */
interface PluginActionHttpResponse {
  /** Action 是否执行成功。 */
  success: boolean;
  /** 可选 Action 结果。 */
  data?: JsonValue;
  /** 可选提示消息。 */
  message?: string;
  /** 可选错误消息。 */
  error?: string;
}

/** 打开 City Plugin 管理器。 */
export async function runInteractivePluginManager(): Promise<void> {
  await run_interactive_plugin_manager();
}

/** 注册统一 Plugin 命令组。 */
export function registerPluginsCommand(program: Command): void {
  const plugin = program
    .command("plugin")
    .description(t({ zh: "管理 City Plugin 与配置", en: "manage City Plugins and configuration" }))
    .helpOption("--help", helpText())
    .action(() => plugin.outputHelp());

  plugin.command("list")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action((options: { json?: boolean }) => print_plugin_list(options.json === true));

  plugin.command("install <source>")
    .helpOption("--help", helpText())
    .action(async (source: string) => {
      const installed = await install_plugin(source);
      emitCliBlock({
        tone: "success",
        title: "Plugin installed",
        summary: installed.id,
        facts: [
          ...(installed.main ? [{ label: "Main", value: installed.main }] : []),
          ...(installed.renderer ? [{ label: "Renderer", value: installed.renderer.entry }] : []),
        ],
      });
    });

  plugin.command("update <plugin_id>")
    .helpOption("--help", helpText())
    .action(async (plugin_id: string) => {
      const installed = await update_plugin(plugin_id);
      emitCliBlock({
        tone: "success",
        title: "Plugin updated",
        summary: installed.id,
        facts: [{ label: "Integrity", value: installed.integrity }],
      });
    });

  plugin.command("uninstall <plugin_id>")
    .helpOption("--help", helpText())
    .action((plugin_id: string) => {
      const removed = remove_installed_plugin(plugin_id);
      emitCliBlock({ tone: "success", title: "Plugin uninstalled", summary: removed.id });
    });

  plugin.command("inspect <plugin_id>")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (plugin_id: string, options: { json?: boolean }) => {
      const catalog = await resolve_plugin_catalog_item(plugin_id);
      if (!catalog) throw new Error(`Plugin not found: ${plugin_id}`);
      const installed = get_installed_plugin(plugin_id);
      printResult({
        type: "block",
        asJson: options.json === true,
        success: true,
        title: "plugin",
        data: { plugin: { ...catalog, ...(installed ?? {}) } },
      });
    });

  register_config_command(plugin);
  register_action_command(plugin);
}

/** 注册 Plugin 唯一配置命令。 */
function register_config_command(plugin: Command): void {
  plugin.command("config <plugin_id>")
    .option("--set <json>", t({ zh: "替换完整 Plugin 配置 JSON", en: "replace the complete Plugin config JSON" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      plugin_id: string,
      options: { set?: string; json?: boolean },
    ) => {
      const catalog = await resolve_plugin_catalog_item(plugin_id);
      if (!catalog) throw new Error(`Plugin not found: ${plugin_id}`);
      if (!catalog.has_config) throw new Error(`Plugin does not provide Config: ${plugin_id}`);
      if (options.set) {
        const config = parse_json_object(options.set, "config");
        const saved = await save_plugin_config(plugin_id, config);
        print_config_status(plugin_id, saved, options.json === true);
        return;
      }
      print_config_status(plugin_id, get_plugin_config(plugin_id), options.json === true);
    });
}

/** 注册运行中 Agent 的 Action 调用命令。 */
function register_action_command(plugin: Command): void {
  plugin.command("action <plugin_id> <action_name> [agent_id]")
    .option("--input <json>", t({ zh: "Action 输入 JSON", en: "Action input JSON" }))
    .option("--host <host>", t({ zh: "覆盖 Gateway host", en: "override Gateway host" }))
    .option("--port <port>", t({ zh: "覆盖 Gateway port", en: "override Gateway port" }), parsePort)
    .option("--workspace <id-or-path>", t({ zh: "指定 Workspace ID 或路径", en: "select Workspace ID or path" }))
    .option("--token <token>", t({ zh: "Agent Bearer Token", en: "Agent Bearer token" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      plugin_id: string,
      action_name: string,
      agent_id: string | undefined,
      options: {
        input?: string;
        host?: string;
        port?: number;
        workspace?: string;
        token?: string;
        json?: boolean;
      },
    ) => {
      const target = await resolve_cli_agent_target(agent_id, options.workspace);
      const remote = await callServer<PluginActionHttpResponse>({
        agent_id: target.agent_id,
        workspace_id: target.workspace_id,
        path: "/api/plugins/action",
        method: "POST",
        timeoutMs: 120_000,
        host: options.host,
        port: options.port,
        authToken: options.token,
        body: {
          plugin_name: plugin_id,
          action_name,
          ...(options.input ? { payload: JSON.parse(options.input) as JsonValue } : {}),
        },
      });
      const result = remote.data;
      printResult({
        type: "block",
        asJson: options.json === true,
        success: remote.success && result?.success === true,
        title: remote.success && result?.success ? "plugin action ok" : "plugin action failed",
        data: {
          agent_id: target.agent_id,
          workspace_id: target.workspace_id,
          plugin_id,
          action_name,
          ...(result?.data !== undefined ? { data: result.data } : {}),
          ...(result?.message ? { message: result.message } : {}),
          ...(!remote.success || result?.error ? { error: result?.error ?? remote.error } : {}),
        },
      });
    });
}

/** 输出 Plugin Catalog。 */
async function print_plugin_list(as_json: boolean): Promise<void> {
  const catalog = list_plugin_catalog();
  if (as_json) {
    printResult({ type: "block", asJson: true, success: true, title: "plugins", data: { plugins: catalog } });
    return;
  }
  emitCliList({
    tone: "accent",
    title: "Plugins",
    summary: `${catalog.length} plugins`,
    items: catalog.map((item) => ({
      title: item.title === item.plugin_id ? item.plugin_id : `${item.title} (${item.plugin_id})`,
      facts: [
        { label: "Description", value: item.description },
        { label: "Source", value: item.source },
        { label: "Config", value: item.has_config ? "supported" : "none" },
      ],
    })),
  });
}

/** 输出配置状态，不把 Plugin 私有配置或凭据写到终端。 */
function print_config_status(
  plugin_id: string,
  config: JsonObject,
  as_json: boolean,
): void {
  printResult({
    type: "block",
    asJson: as_json,
    success: true,
    title: "plugin config",
    data: {
      plugin_id,
      configured: Object.keys(config).length > 0,
      fields: Object.keys(config).sort(),
    },
  });
}

/** 解析并要求 JSON 对象。 */
function parse_json_object(input: string, label: string): JsonObject {
  const value = JSON.parse(input) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}
