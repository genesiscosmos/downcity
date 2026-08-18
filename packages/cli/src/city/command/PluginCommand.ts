/**
 * `downcity plugin` 命令树。
 *
 * Plugin 以稳定 ID 管理，profile 保存于 Plugin 自己的 `config.toml`，Agent 只在
 * `agent.json` 中引用 Plugin 与可选 profile。
 */

import type { Command } from "commander";
import type { JsonObject, JsonValue } from "@downcity/agent";
import {
  resolve_cli_agent_id,
  resolve_cli_agent_target,
} from "@/city/agent/AgentSelection.js";
import { callServer } from "@/city/process/daemon/Client.js";
import {
  get_agent_plugin_reference,
  get_installed_plugin,
  get_plugin_profile,
  list_agent_plugin_references,
  list_plugin_profiles,
  remove_agent_plugin_reference,
  remove_installed_plugin,
  remove_plugin_profile,
  save_plugin_profile,
  set_agent_plugin_reference,
} from "@/city/process/registry/PluginRepository.js";
import { install_plugin, update_plugin } from "@/city/process/plugin/PluginInstaller.js";
import {
  resolve_plugin_catalog_item,
  list_plugin_catalog,
} from "@/city/process/plugin/PluginCatalog.js";
import { prompt_plugin_config } from "@/city/process/plugin/PluginConfigForm.js";
import { redact_plugin_config } from "@/city/process/plugin/PluginConfigRedaction.js";
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
    .description(t({ zh: "管理 Plugin、profile 与 Agent 引用", en: "manage Plugins, profiles, and Agent references" }))
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
        facts: [{ label: "Setup", value: installed.setup }],
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

  register_agent_reference_commands(plugin);
  register_profile_commands(plugin);
  register_action_command(plugin);
}

/** 注册 Agent Plugin 引用命令。 */
function register_agent_reference_commands(plugin: Command): void {
  plugin.command("enable <plugin_id> [agent_id]")
    .option("--profile <profile>", t({ zh: "选择 Plugin profile", en: "select a Plugin profile" }))
    .helpOption("--help", helpText())
    .action(async (
      plugin_id: string,
      agent_id: string | undefined,
      options: { profile?: string },
    ) => {
      const resolved_agent_id = await resolve_cli_agent_id(agent_id);
      const reference = set_agent_plugin_reference({
        agent_id: resolved_agent_id,
        plugin_id,
        ...(options.profile ? { profile: options.profile } : {}),
      });
      emitCliBlock({
        tone: "success",
        title: "Plugin enabled",
        summary: `${reference.plugin_id} · ${reference.agent_id}`,
        ...(reference.profile ? { facts: [{ label: "Profile", value: reference.profile }] } : {}),
        note: "新的 Plugin 装配会在下次 City 装配 Agent 时生效。",
      });
    });

  plugin.command("disable <plugin_id> [agent_id]")
    .helpOption("--help", helpText())
    .action(async (plugin_id: string, agent_id: string | undefined) => {
      const resolved_agent_id = await resolve_cli_agent_id(agent_id);
      if (!get_agent_plugin_reference(resolved_agent_id, plugin_id)) {
        throw new Error(`Plugin is not registered by Agent: ${plugin_id}`);
      }
      remove_agent_plugin_reference(resolved_agent_id, plugin_id);
      emitCliBlock({
        tone: "success",
        title: "Plugin disabled",
        summary: `${plugin_id} · ${resolved_agent_id}`,
      });
    });

  plugin.command("enabled [agent_id]")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (agent_id: string | undefined, options: { json?: boolean }) => {
      const resolved_agent_id = await resolve_cli_agent_id(agent_id);
      const references = list_agent_plugin_references(resolved_agent_id);
      printResult({
        type: "block",
        asJson: options.json === true,
        success: true,
        title: "agent plugins",
        data: { agent_id: resolved_agent_id, plugins: references },
      });
    });
}

/** 注册 Plugin profile 命令。 */
function register_profile_commands(plugin: Command): void {
  plugin.command("profiles <plugin_id>")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action((plugin_id: string, options: { json?: boolean }) => {
      const profiles = list_plugin_profiles(plugin_id);
      printResult({
        type: "block",
        asJson: options.json === true,
        success: true,
        title: "plugin profiles",
        data: { plugin_id, profiles },
      });
    });

  plugin.command("config <plugin_id> [profile]")
    .option("--set <json>", t({ zh: "替换完整 profile JSON", en: "replace the complete profile JSON" }))
    .option("--interactive", t({ zh: "打开 Schema 配置表单", en: "open the Schema form" }))
    .option("--remove", t({ zh: "删除该 profile", en: "remove this profile" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      plugin_id: string,
      profile_input: string | undefined,
      options: { set?: string; interactive?: boolean; remove?: boolean; json?: boolean },
    ) => {
      const profile = String(profile_input || "default").trim();
      const catalog = await resolve_plugin_catalog_item(plugin_id);
      if (!catalog) throw new Error(`Plugin not found: ${plugin_id}`);
      if (options.remove) {
        remove_plugin_profile(plugin_id, profile);
        emitCliBlock({ tone: "success", title: "Plugin profile removed", summary: `${plugin_id}/${profile}` });
        return;
      }
      const existing = get_plugin_profile(plugin_id, profile);
      let config: JsonObject | null = null;
      if (options.set) config = parse_json_object(options.set, "profile");
      if (options.interactive) {
        if (!catalog.config_schema) throw new Error(`Plugin does not declare configuration: ${plugin_id}`);
        config = await prompt_plugin_config({
          plugin_name: plugin_id,
          schema: catalog.config_schema,
          current_config: existing ?? catalog.default_config,
        });
      }
      if (config) {
        const saved = await save_plugin_profile(plugin_id, profile, config);
        print_profile(plugin_id, profile, saved, catalog.config_schema, options.json === true);
        return;
      }
      if (!existing) throw new Error(`Plugin profile not found: ${plugin_id}/${profile}`);
      print_profile(plugin_id, profile, existing, catalog.config_schema, options.json === true);
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
        { label: "Profiles", value: item.profiles.join(", ") || "none" },
      ],
    })),
  });
}

/** 输出一个经过凭据脱敏的 Plugin profile。 */
function print_profile(
  plugin_id: string,
  profile: string,
  config: JsonObject,
  schema: JsonObject | undefined,
  as_json: boolean,
): void {
  printResult({
    type: "block",
    asJson: as_json,
    success: true,
    title: "plugin profile",
    data: { plugin_id, profile, config: redact_plugin_config(config, schema) },
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
