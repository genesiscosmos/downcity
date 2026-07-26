/**
 * `city plugin` 命令树。
 *
 * 关键点（中文）
 * - Plugin 制品全局安装，启用状态与配置按 Agent Binding 保存。
 * - CLI、HTTP 与 Agent 工具调用统一执行 Plugin Action。
 * - 未传 Agent ID 时只使用全局 Agent Selector，不根据当前目录推断。
 */

import fs from "fs-extra";
import type { Command } from "commander";
import type { JsonObject, JsonValue } from "@downcity/agent";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import { callServer } from "@/city/process/daemon/Client.js";
import { get_installed_plugin_dir_path } from "@/city/process/registry/CityPaths.js";
import {
  get_agent_plugin_binding,
  get_installed_plugin,
  is_builtin_plugin,
  list_agent_plugin_bindings,
  list_installed_plugins,
  remove_agent_plugin_binding,
  remove_installed_plugin,
  set_agent_plugin_binding,
} from "@/city/process/registry/PluginRepository.js";
import { install_plugin } from "@/city/process/plugin/PluginInstaller.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { helpText, t } from "@/shared/CliLocale.js";
import { parsePort } from "@/shared/IndexSupport.js";
import { list_city_builtin_plugin_descriptors } from "@/city/runtime/plugins/CityBuiltinPlugins.js";

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

/** City TUI 中的 Plugin 面板；展示全局可用制品，写操作仍使用明确子命令。 */
export async function runInteractivePluginManager(): Promise<void> {
  const installed = list_installed_plugins();
  const builtins = list_city_builtin_plugin_descriptors();
  emitCliList({
    tone: "accent",
    title: "Plugins",
    summary: `${builtins.length + installed.length} available`,
    items: [
      ...builtins.map((plugin) => ({
        title: plugin.plugin_name,
        facts: [
          { label: "Source", value: "builtin" },
          { label: "Actions", value: plugin.actions.join(", ") || "none" },
        ],
      })),
      ...installed.map((item) => ({
        title: item.plugin_name,
        facts: [
          { label: "Source", value: item.source },
          { label: "Version", value: item.version },
        ],
      })),
    ],
  });
}

/** 注册统一 Plugin 命令组。 */
export function registerPluginsCommand(program: Command): void {
  const plugin = program
    .command("plugin")
    .description(t({ zh: "管理全局 Plugin 与 Agent Binding", en: "manage global plugins and Agent bindings" }))
    .helpOption("--help", helpText())
    .action(() => plugin.outputHelp());

  plugin
    .command("list")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action((options: { json?: boolean }) => {
      const builtins = list_city_builtin_plugin_descriptors().map((descriptor) => ({
        ...descriptor,
        source: "builtin" as const,
      }));
      const installed = list_installed_plugins().map((item) => ({
        plugin_name: item.plugin_name,
        source: item.source,
        version: item.version,
      }));
      if (options.json) {
        printResult({
          asJson: true,
          success: true,
          title: "plugins",
          payload: { plugins: [...builtins, ...installed] },
        });
        return;
      }
      emitCliList({
        tone: "accent",
        title: "Plugins",
        summary: `${builtins.length + installed.length} available`,
        items: [...builtins, ...installed].map((item) => ({
          title: item.plugin_name,
          facts: [{ label: "Source", value: item.source }],
        })),
      });
    });

  plugin
    .command("install <source>")
    .helpOption("--help", helpText())
    .action(async (source: string) => {
      const installed = await install_plugin(source);
      emitCliBlock({
        tone: "success",
        title: "Plugin installed",
        summary: installed.plugin_name,
        facts: [
          { label: "Version", value: installed.version },
          { label: "Entry", value: installed.entry_path },
        ],
      });
    });

  plugin
    .command("uninstall <plugin_name>")
    .helpOption("--help", helpText())
    .action(async (plugin_name: string) => {
      if (is_builtin_plugin(plugin_name)) throw new Error("Builtin plugins cannot be uninstalled");
      const installed = get_installed_plugin(plugin_name);
      if (!installed) throw new Error(`Plugin is not installed: ${plugin_name}`);
      remove_installed_plugin(plugin_name);
      await fs.remove(get_installed_plugin_dir_path(plugin_name));
      emitCliBlock({ tone: "success", title: "Plugin uninstalled", summary: plugin_name });
    });

  plugin
    .command("inspect <plugin_name>")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action((plugin_name: string, options: { json?: boolean }) => {
      const installed = get_installed_plugin(plugin_name);
      const builtin = list_city_builtin_plugin_descriptors()
        .find((item) => item.plugin_name === plugin_name);
      const data = installed ?? (builtin ? { ...builtin, source: "builtin" } : null);
      if (!data) throw new Error(`Plugin not found: ${plugin_name}`);
      printResult({
        asJson: options.json === true,
        success: true,
        title: "plugin",
        payload: { plugin: { ...data } },
      });
    });

  register_binding_commands(plugin);
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
      const installed = get_installed_plugin(plugin_name);
      const existing = get_agent_plugin_binding(target.agent_id, plugin_name);
      const config = options.config
        ? parse_json_object(options.config, "config")
        : existing?.config ?? installed?.manifest.default_config ?? {};
      const binding = set_agent_plugin_binding({
        agent_id: target.agent_id,
        plugin_name,
        enabled: true,
        config,
      });
      emitCliBlock({
        tone: "success",
        title: "Plugin enabled",
        summary: `${binding.plugin_name} · ${binding.agent_id}`,
        note: "如果 Agent 正在运行，请重启 Agent 以应用新的 Runtime 装配。",
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
        note: "如果 Agent 正在运行，请重启 Agent 以应用新的 Runtime 装配。",
      });
    });

  plugin
    .command("config <plugin_name> [agent_id]")
    .option("--set <json>", t({ zh: "替换完整配置 JSON", en: "replace complete config JSON" }))
    .option("--remove", t({ zh: "删除该 Agent Binding", en: "remove this Agent binding" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      plugin_name: string,
      agent_id: string | undefined,
      options: { set?: string; remove?: boolean; json?: boolean },
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
        });
        print_binding(binding, options.json === true);
        return;
      }
      if (!existing) throw new Error(`Plugin is not bound to agent: ${plugin_name}`);
      print_binding(existing, options.json === true);
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
        asJson: options.json === true,
        success: remote.success && result?.success === true,
        title: remote.success && result?.success ? "plugin action ok" : "plugin action failed",
        payload: {
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
  printResult({
    asJson: as_json,
    success: true,
    title: "plugin binding",
    payload: { binding: { ...binding } },
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
