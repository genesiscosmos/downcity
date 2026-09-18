/**
 * `downcity power` 命令树。
 *
 * Power 以稳定 ID 管理，唯一配置保存于 Power 自己的 `config.toml`。
 */

import type { Command } from "commander";
import type { JsonObject, JsonValue } from "@downcity/agent";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import { callServer } from "@/city/process/daemon/Client.js";
import {
  get_installed_power,
  get_power_config,
  remove_installed_power,
  save_power_config,
} from "@/city/process/registry/PowerRepository.js";
import { install_power, update_power } from "@/city/process/power/PowerInstaller.js";
import {
  resolve_power_catalog_item,
  list_power_catalog,
} from "@/city/process/power/PowerCatalog.js";
import { run_interactive_power_manager } from "@/city/process/power/InteractivePowerManager.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { helpText, t } from "@/shared/CliLocale.js";
import { parsePort } from "@/shared/IndexSupport.js";

/** Power Action HTTP 返回结构。 */
interface PowerActionHttpResponse {
  /** Action 是否执行成功。 */
  success: boolean;
  /** 可选 Action 结果。 */
  data?: JsonValue;
  /** 可选提示消息。 */
  message?: string;
  /** 可选错误消息。 */
  error?: string;
}

/** 打开 City Power 管理器。 */
export async function runInteractivePowerManager(): Promise<void> {
  await run_interactive_power_manager();
}

/** 注册统一 Power 命令组。 */
export function registerPowersCommand(program: Command): void {
  const power = program
    .command("power")
    .description(t({ zh: "管理 City Power 与配置", en: "manage City Powers and configuration" }))
    .helpOption("--help", helpText())
    .action(() => power.outputHelp());

  power.command("list")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action((options: { json?: boolean }) => print_power_list(options.json === true));

  power.command("install <source>")
    .helpOption("--help", helpText())
    .action(async (source: string) => {
      const installed = await install_power(source);
      emitCliBlock({
        tone: "success",
        title: "Power installed",
        summary: installed.id,
        facts: [
          ...(installed.main ? [{ label: "Main", value: installed.main }] : []),
          ...(installed.renderer ? [{ label: "Renderer", value: installed.renderer.entry }] : []),
        ],
      });
    });

  power.command("update <power_id>")
    .helpOption("--help", helpText())
    .action(async (power_id: string) => {
      const installed = await update_power(power_id);
      emitCliBlock({
        tone: "success",
        title: "Power updated",
        summary: installed.id,
        facts: [{ label: "Integrity", value: installed.integrity }],
      });
    });

  power.command("uninstall <power_id>")
    .helpOption("--help", helpText())
    .action((power_id: string) => {
      const removed = remove_installed_power(power_id);
      emitCliBlock({ tone: "success", title: "Power uninstalled", summary: removed.id });
    });

  power.command("inspect <power_id>")
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (power_id: string, options: { json?: boolean }) => {
      const catalog = await resolve_power_catalog_item(power_id);
      if (!catalog) throw new Error(`Power not found: ${power_id}`);
      const installed = get_installed_power(power_id);
      printResult({
        type: "block",
        asJson: options.json === true,
        success: true,
        title: "power",
        data: { power: { ...catalog, ...(installed ?? {}) } },
      });
    });

  register_config_command(power);
  register_action_command(power);
}

/** 注册 Power 唯一配置命令。 */
function register_config_command(power: Command): void {
  power.command("config <power_id>")
    .option("--set <json>", t({ zh: "替换完整 Power 配置 JSON", en: "replace the complete Power config JSON" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      power_id: string,
      options: { set?: string; json?: boolean },
    ) => {
      const catalog = await resolve_power_catalog_item(power_id);
      if (!catalog) throw new Error(`Power not found: ${power_id}`);
      if (!catalog.has_config) throw new Error(`Power does not provide Config: ${power_id}`);
      if (options.set) {
        const config = parse_json_object(options.set, "config");
        const saved = await save_power_config(power_id, config);
        print_config_status(power_id, saved, options.json === true);
        return;
      }
      print_config_status(power_id, get_power_config(power_id), options.json === true);
    });
}

/** 注册运行中 Agent 的 Action 调用命令。 */
function register_action_command(power: Command): void {
  power.command("action <power_id> <action_name> [agent_id]")
    .option("--input <json>", t({ zh: "Action 输入 JSON", en: "Action input JSON" }))
    .option("--host <host>", t({ zh: "覆盖 Gateway host", en: "override Gateway host" }))
    .option("--port <port>", t({ zh: "覆盖 Gateway port", en: "override Gateway port" }), parsePort)
    .option("--workspace <id-or-path>", t({ zh: "指定 Workspace ID 或路径", en: "select Workspace ID or path" }))
    .option("--token <token>", t({ zh: "Agent Bearer Token", en: "Agent Bearer token" }))
    .option("--json", t({ zh: "以 JSON 输出", en: "output as JSON" }))
    .helpOption("--help", helpText())
    .action(async (
      power_id: string,
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
      const remote = await callServer<PowerActionHttpResponse>({
        agent_id: target.agent_id,
        workspace_id: target.workspace_id,
        path: "/api/powers/action",
        method: "POST",
        timeoutMs: 120_000,
        host: options.host,
        port: options.port,
        authToken: options.token,
        body: {
          power_name: power_id,
          action_name,
          ...(options.input ? { payload: JSON.parse(options.input) as JsonValue } : {}),
        },
      });
      const result = remote.data;
      printResult({
        type: "block",
        asJson: options.json === true,
        success: remote.success && result?.success === true,
        title: remote.success && result?.success ? "power action ok" : "power action failed",
        data: {
          agent_id: target.agent_id,
          workspace_id: target.workspace_id,
          power_id,
          action_name,
          ...(result?.data !== undefined ? { data: result.data } : {}),
          ...(result?.message ? { message: result.message } : {}),
          ...(!remote.success || result?.error ? { error: result?.error ?? remote.error } : {}),
        },
      });
    });
}

/** 输出 Power Catalog。 */
async function print_power_list(as_json: boolean): Promise<void> {
  const catalog = list_power_catalog();
  if (as_json) {
    printResult({ type: "block", asJson: true, success: true, title: "powers", data: { powers: catalog } });
    return;
  }
  emitCliList({
    tone: "accent",
    title: "Powers",
    summary: `${catalog.length} powers`,
    items: catalog.map((item) => ({
      title: item.title === item.power_id ? item.power_id : `${item.title} (${item.power_id})`,
      facts: [
        { label: "Description", value: item.description },
        { label: "Source", value: item.source },
        { label: "Config", value: item.has_config ? "supported" : "none" },
      ],
    })),
  });
}

/** 输出配置状态，不把 Power 私有配置或凭据写到终端。 */
function print_config_status(
  power_id: string,
  config: JsonObject,
  as_json: boolean,
): void {
  printResult({
    type: "block",
    asJson: as_json,
    success: true,
    title: "power config",
    data: {
      power_id,
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
