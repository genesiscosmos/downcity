/**
 * `city plugin` 命令树。
 *
 * 关键点（中文）
 * - Plugin 数组制品全局安装，启用状态与配置按 Agent Binding 保存。
 * - CLI、HTTP 与 Agent 工具调用统一执行 Plugin Action。
 * - 未传 Agent ID 时只使用全局 Agent Selector，不根据当前目录推断。
 */

import fs from "fs-extra";
import type { Command } from "commander";
import type { JsonObject, JsonValue } from "@downcity/agent";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import { callServer } from "@/city/process/daemon/Client.js";
import { get_plugin_installation_dir_path } from "@/city/process/registry/CityPaths.js";
import {
  get_agent_plugin_binding,
  get_installed_plugin,
  is_builtin_plugin,
  list_agent_plugin_bindings,
  remove_agent_plugin_binding,
  remove_plugin_installation,
  set_agent_plugin_binding,
} from "@/city/process/registry/PluginRepository.js";
import {
  install_plugins,
  update_plugin,
} from "@/city/process/plugin/PluginInstaller.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { helpText, t } from "@/shared/CliLocale.js";
import { parsePort } from "@/shared/IndexSupport.js";
import {
  get_plugin_catalog_item,
  list_plugin_catalog,
} from "@/city/process/plugin/PluginCatalog.js";
import { run_interactive_plugin_manager } from "@/city/process/plugin/InteractivePluginManager.js";
import { prompt_and_save_plugin_binding } from "@/city/process/plugin/PluginBindingConfiguration.js";
import {
  create_plugin_resource,
  refresh_plugin_resource,
  update_plugin_resource,
} from "@/city/process/plugin/PluginResourceService.js";
import {
  list_plugin_resources,
  remove_plugin_resource,
} from "@/city/process/registry/PluginResourceRepository.js";
import { prompt_plugin_resource_fields } from "@/city/process/plugin/PluginConfigForm.js";
import { redact_plugin_schema_value } from "@/city/process/plugin/PluginResourceSchema.js";

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

/** City TUI 中的统一 Plugin 制品与 Binding 管理器。 */
export async function runInteractivePluginManager(): Promise<void> {
  await run_interactive_plugin_manager();
}

/** 注册统一 Plugin 命令组。 */
export function registerPluginsCommand(program: Command): void {
  const plugin = program
    .command("plugin")
    .description(t({ zh: "管理 Plugin 与 Agent Binding", en: "manage Plugins and Agent bindings" }))
    .helpOption("--help", helpText())
    .action(() => plugin.outputHelp());

  plugin
    .command("list")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action((options: { json?: boolean }) => {
      const catalog = list_plugin_catalog();
      if (options.json) {
        printResult({
          type: "block",
          asJson: true,
          success: true,
          title: "plugins",
          data: { plugins: catalog },
        });
        return;
      }
      emitCliList({
        tone: "accent",
        title: "Plugins",
        summary: `${catalog.length} plugins`,
        items: catalog.map((item) => ({
          title: item.title === item.plugin_name
            ? item.plugin_name
            : `${item.title} (${item.plugin_name})`,
          facts: [
            { label: "Description", value: item.description },
            { label: "Source", value: item.source },
            ...(item.version ? [{ label: "Version", value: item.version }] : []),
          ],
        })),
      });
    });

  plugin
    .command("update <plugin_name>")
    .helpOption("--help", helpText())
    .action(async (plugin_name: string) => {
      const installation = await update_plugin(plugin_name);
      emitCliBlock({
        tone: "success",
        title: "Plugins updated",
        summary: installation.manifest.plugins.map((plugin) => plugin.name).join(", "),
        facts: [
          { label: "Integrity", value: installation.integrity },
          ...(installation.resolved_commit
            ? [{ label: "Commit", value: installation.resolved_commit }]
            : []),
        ],
      });
    });

  plugin
    .command("install <source>")
    .helpOption("--help", helpText())
    .action(async (source: string) => {
      const installation = await install_plugins(source);
      emitCliBlock({
        tone: "success",
        title: "Plugins installed",
        summary: installation.manifest.plugins.map((plugin) => plugin.name).join(", "),
        facts: [
          { label: "Entry", value: installation.entry_path },
        ],
      });
    });

  plugin
    .command("uninstall <plugin_name>")
    .helpOption("--help", helpText())
    .action(async (plugin_name: string) => {
      if (is_builtin_plugin(plugin_name)) throw new Error("Builtin Plugins cannot be uninstalled");
      const installation = remove_plugin_installation(plugin_name);
      await fs.remove(get_plugin_installation_dir_path(installation.installation_id));
      emitCliBlock({
        tone: "success",
        title: "Plugins uninstalled",
        summary: installation.manifest.plugins.map((plugin) => plugin.name).join(", "),
      });
    });

  plugin
    .command("inspect <plugin_name>")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action((plugin_name: string, options: { json?: boolean }) => {
      const catalog_item = get_plugin_catalog_item(plugin_name);
      if (!catalog_item) throw new Error(`Plugin not found: ${plugin_name}`);
      const installed = get_installed_plugin(plugin_name)?.installation;
      printResult({
        type: "block",
        asJson: options.json === true,
        success: true,
        title: "plugin",
        data: {
          plugin: {
            ...catalog_item,
            ...(installed
              ? {
                  resolved_commit: installed.resolved_commit,
                  integrity: installed.integrity,
                  installed_at: installed.installed_at,
                  updated_at: installed.updated_at,
                }
              : {}),
          },
        },
      });
    });

  register_binding_commands(plugin);
  register_resource_commands(plugin);
  register_action_command(plugin);
}

/** 注册 enable/disable/config 三个 Binding 命令。 */
function register_binding_commands(plugin: Command): void {
  plugin
    .command("enable <plugin_name> [agent_id]")
    .option("--config <json>", t({ zh: "完整配置 JSON", en: "complete config JSON" }))
    .helpOption("--help", helpText())
    .action(async (plugin_name: string, agent_id: string | undefined, options: { config?: string }) => {
      const target = await resolve_cli_agent_target(agent_id);
      const catalog_item = get_plugin_catalog_item(plugin_name);
      if (!catalog_item) throw new Error(`Plugin not found: ${plugin_name}`);
      const existing = get_agent_plugin_binding(target.agent_id, plugin_name);
      const config = options.config
        ? parse_json_object(options.config, "config")
        : existing?.config ?? catalog_item.default_config;
      const binding = set_agent_plugin_binding({
        agent_id: target.agent_id,
        plugin_name,
        enabled: true,
        config,
        resource_ids: existing?.resource_ids ?? [],
      });
      emitCliBlock({
        tone: "success",
        title: "Plugin enabled",
        summary: `${binding.plugin_name} · ${binding.agent_id}`,
        note: "新的 Plugin 装配会在下次 City 装配 Agent 时生效。",
      });
    });

  plugin
    .command("disable <plugin_name> [agent_id]")
    .helpOption("--help", helpText())
    .action(async (plugin_name: string, agent_id: string | undefined) => {
      const target = await resolve_cli_agent_target(agent_id);
      const existing = get_agent_plugin_binding(target.agent_id, plugin_name);
      if (!existing) throw new Error(`Plugin is not bound to agent: ${plugin_name}`);
      set_agent_plugin_binding({ ...existing, enabled: false });
      emitCliBlock({
        tone: "success",
        title: "Plugin disabled",
        summary: `${plugin_name} · ${target.agent_id}`,
        note: "新的 Plugin 装配会在下次 City 装配 Agent 时生效。",
      });
    });

  plugin
    .command("config <plugin_name> [agent_id]")
    .option("--set <json>", t({ zh: "替换完整配置 JSON", en: "replace complete config JSON" }))
    .option("--interactive", t({ zh: "打开 Schema 配置表单", en: "open Schema configuration form" }))
    .option("--remove", t({ zh: "删除该 Agent Binding", en: "remove this Agent binding" }))
    .option("--resources <json>", t({ zh: "替换 Resource ID 数组", en: "replace Resource ID array" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      plugin_name: string,
      agent_id: string | undefined,
      options: {
        set?: string;
        interactive?: boolean;
        remove?: boolean;
        resources?: string;
        json?: boolean;
      },
    ) => {
      const target = await resolve_cli_agent_target(agent_id);
      const existing = get_agent_plugin_binding(target.agent_id, plugin_name);
      if (options.remove) {
        remove_agent_plugin_binding(target.agent_id, plugin_name);
        emitCliBlock({ tone: "success", title: "Plugin binding removed", summary: plugin_name });
        return;
      }
      if (options.set) {
        const binding = set_agent_plugin_binding({
          agent_id: target.agent_id,
          plugin_name,
          enabled: existing?.enabled ?? true,
          config: parse_json_object(options.set, "config"),
          resource_ids: options.resources
            ? parse_json_string_array(options.resources, "resources")
            : existing?.resource_ids ?? [],
        });
        print_binding(binding, options.json === true);
        return;
      }
      if (options.resources) {
        if (!existing) throw new Error(`Plugin is not bound to agent: ${plugin_name}`);
        const binding = set_agent_plugin_binding({
          ...existing,
          resource_ids: parse_json_string_array(options.resources, "resources"),
        });
        print_binding(binding, options.json === true);
        return;
      }
      if (options.interactive) {
        const catalog_item = get_plugin_catalog_item(plugin_name);
        if (!catalog_item) throw new Error(`Plugin not found: ${plugin_name}`);
        const binding = await prompt_and_save_plugin_binding({
          agent_id: target.agent_id,
          plugin: catalog_item,
          enabled: existing?.enabled ?? true,
        });
        if (binding) print_binding(binding, options.json === true);
        return;
      }
      if (!existing) throw new Error(`Plugin is not bound to agent: ${plugin_name}`);
      print_binding(existing, options.json === true);
    });
}

/** 注册通用 Plugin Resource 命令。 */
function register_resource_commands(plugin: Command): void {
  const resource = plugin
    .command("resource")
    .description(t({ zh: "管理完整 Plugin Resource", en: "manage complete Plugin Resources" }))
    .helpOption("--help", helpText())
    .action(() => resource.outputHelp());

  resource
    .command("list <plugin_name>")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action((plugin_name: string, options: { json?: boolean }) => {
      const catalog_item = get_plugin_catalog_item(plugin_name);
      if (!catalog_item?.resource_schema) {
        throw new Error(`Plugin does not declare Resources: ${plugin_name}`);
      }
      const resources = list_plugin_resources(plugin_name).map((item) => ({
        ...item,
        item: redact_plugin_schema_value(item.item, catalog_item.resource_schema),
      }));
      printResult({
        type: "block",
        asJson: options.json === true,
        success: true,
        title: "plugin resources",
        data: { plugin_name: catalog_item.plugin_name, resources },
      });
    });

  resource
    .command("create <plugin_name>")
    .option("--set <json>", t({ zh: "Resource 用户字段 JSON", en: "Resource user fields JSON" }))
    .option("--interactive", t({ zh: "打开 Schema 表单", en: "open Schema form" }))
    .helpOption("--help", helpText())
    .action(async (
      plugin_name: string,
      options: { set?: string; interactive?: boolean },
    ) => {
      const catalog_item = get_plugin_catalog_item(plugin_name);
      if (!catalog_item?.resource_schema) {
        throw new Error(`Plugin does not declare Resources: ${plugin_name}`);
      }
      const fields = options.set
        ? parse_json_object(options.set, "resource")
        : options.interactive
          ? await prompt_plugin_resource_fields({
              plugin_name: catalog_item.plugin_name,
              schema: catalog_item.resource_schema,
            })
          : null;
      if (!fields) {
        throw new Error("Use --set <json> or --interactive to create a Plugin Resource");
      }
      const created = await create_plugin_resource({ plugin_name, fields });
      emitCliBlock({
        tone: "success",
        title: "Plugin Resource created",
        summary: `${created.item.name} · ${created.resource_id}`,
        facts: [{ label: "Type", value: created.item.type }],
      });
    });

  resource
    .command("update <plugin_name> <resource_id>")
    .option(
      "--set <json>",
      t({ zh: "替换完整 Resource 用户字段 JSON", en: "replace complete Resource user fields JSON" }),
    )
    .helpOption("--help", helpText())
    .action(async (
      plugin_name: string,
      resource_id: string,
      options: { set?: string },
    ) => {
      if (!options.set) {
        throw new Error("Use --set <json> to update a Plugin Resource");
      }
      const updated = await update_plugin_resource({
        plugin_name,
        resource_id,
        fields: parse_json_object(options.set, "resource"),
      });
      emitCliBlock({
        tone: "success",
        title: "Plugin Resource updated",
        summary: `${updated.item.name} · ${updated.resource_id}`,
        facts: [{ label: "Type", value: updated.item.type }],
      });
    });

  resource
    .command("refresh <plugin_name> <resource_id>")
    .helpOption("--help", helpText())
    .action(async (plugin_name: string, resource_id: string) => {
      const refreshed = await refresh_plugin_resource(plugin_name, resource_id);
      emitCliBlock({
        tone: "success",
        title: "Plugin Resource refreshed",
        summary: `${refreshed.item.name} · ${refreshed.resource_id}`,
      });
    });

  resource
    .command("remove <plugin_name> <resource_id>")
    .helpOption("--help", helpText())
    .action((plugin_name: string, resource_id: string) => {
      remove_plugin_resource(plugin_name, resource_id);
      emitCliBlock({
        tone: "success",
        title: "Plugin Resource removed",
        summary: `${plugin_name} · ${resource_id}`,
      });
    });
}

/** 注册运行中 Agent 的统一 Action 调用命令。 */
function register_action_command(plugin: Command): void {
  plugin
    .command("action <plugin_name> <action_name> [agent_id]")
    .option("--input <json>", t({ zh: "Action 输入 JSON", en: "Action input JSON" }))
    .option("--host <host>", t({ zh: "覆盖 Gateway host", en: "override Gateway host" }))
    .option("--port <port>", t({ zh: "覆盖 Gateway port", en: "override Gateway port" }), parsePort)
    .option("--token <token>", t({ zh: "Agent Bearer Token", en: "Agent Bearer token" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      plugin_name: string,
      action_name: string,
      agent_id: string | undefined,
      options: { input?: string; host?: string; port?: number; token?: string; json?: boolean },
    ) => {
      const target = await resolve_cli_agent_target(agent_id);
      const remote = await callServer<PluginActionHttpResponse>({
        agent_id: target.agent_id,
        path: "/api/plugins/action",
        method: "POST",
        timeoutMs: 120_000,
        host: options.host,
        port: options.port,
        authToken: options.token,
        body: {
          plugin_name,
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
          plugin_name,
          action_name,
          ...(result?.data !== undefined ? { data: result.data } : {}),
          ...(result?.message ? { message: result.message } : {}),
          ...(!remote.success || result?.error ? { error: result?.error ?? remote.error } : {}),
        },
      });
    });
}

/** 输出一个 Agent Plugin Binding。 */
function print_binding(binding: ReturnType<typeof list_agent_plugin_bindings>[number], as_json: boolean): void {
  const schema = get_plugin_catalog_item(binding.plugin_name)?.config_schema;
  printResult({
    type: "block",
    asJson: as_json,
    success: true,
    title: "plugin binding",
    data: {
      binding: {
        ...binding,
        config: redact_plugin_schema_value(binding.config, schema) as JsonObject,
      },
    },
  });
}

/** 解析并要求 JSON 字符串数组。 */
function parse_json_string_array(input: string, label: string): string[] {
  const value = JSON.parse(input) as unknown;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a JSON string array`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

/** 解析并要求 JSON 对象。 */
function parse_json_object(input: string, label: string): JsonObject {
  const value = JSON.parse(input) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}
