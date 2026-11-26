/**
 * `city power` 统一命令树。
 *
 * 内置能力、单包制品和代码来源共用管理身份与操作路由；底层快照协议保留职责边界。
 */

import type { Command } from "commander";
import type { JsonValue } from "@downcity/agent";
import { randomUUID } from "node:crypto";
import { PowerManagement, code_power_view } from "../process/power/PowerManagement.js";
import { power_options, run_power_command, type PowerCommandOptions } from "./PowerCommandSupport.js";
import { register_power_configuration } from "./PowerConfiguration.js";
import type { ExtensionManager } from "@downcity/city/local";
import { resolve_cli_agent_target } from "@/city/agent/AgentSelection.js";
import { callServer } from "@/city/process/daemon/Client.js";
import { run_interactive_power_manager } from "@/city/process/power/InteractivePowerManager.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
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

  power_options(power.command("list"))
    .action(async (options: PowerCommandOptions) => await run_power_command(options, async () => ({ powers: await new PowerManagement(options.root).list() })));

  power_options(power.command("install <source>"), true)
    .option("--ref <ref>", "Git branch, tag or commit")
    .action(async (source: string, options: PowerCommandOptions) => await run_power_command(options, async () => ({ power: await new PowerManagement(options.root).install(source, options.ref, options.operationId ?? randomUUID()) })));

  for (const method of ["update", "reload", "uninstall"] as const) {
    power_options(power.command(`${method} <power_id>`), true)
      .action(async (power_id: string, options: PowerCommandOptions) => await run_power_command(options, async () => {
        const manager = new PowerManagement(options.root);
        const operation_id = options.operationId ?? randomUUID();
        return { power: method === "uninstall" ? await manager.uninstall(power_id, operation_id) : await manager.refresh(power_id, operation_id) };
      }));
  }

  power_options(power.command("inspect <power_id>"))
    .action(async (power_id: string, options: PowerCommandOptions) => await run_power_command(options, async () => ({ power: await new PowerManagement(options.root).inspect(power_id), inspected: true })));

  for (const method of ["definitions", "connections"] as const) {
    power_options(power.command(method))
      .action(async (options: PowerCommandOptions) => await run_power_command(options, async () => await new PowerManagement(options.root).code.call(`extension.${method}`)));
  }
  power_options(power.command("operation <operation_id>"))
    .action(async (operation_id: string, options: PowerCommandOptions) => await run_power_command(options, async () => {
      const operation = await new PowerManagement(options.root).code.call("extension.operation", { operation_id }) as ReturnType<ExtensionManager["operation"]>;
      return operation ? { operation_id: operation.operation_id, power_id: operation.extension_id, power: operation.result ? code_power_view(operation.result) : null } : { operation_id, found: false };
    }));

  register_power_configuration(power);
  register_action_command(power);
}

/** 注册运行中 Agent 的 Action 调用命令。 */
function register_action_command(power: Command): void {
  power.command("action <power_id> <action_name> [agent_id]")
    .option("--entry <entry_id>", "Runtime entry from power inspect")
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
        /** Action 输入 JSON。 */
        input?: string;
        /** 显式远端 Gateway 地址。 */
        host?: string;
        /** 显式 Gateway 端口。 */
        port?: number;
        /** 执行 Workspace ID 或路径。 */
        workspace?: string;
        /** Agent 的 Gateway 访问令牌。 */
        token?: string;
        /** 唯一 JSON 输出模式。 */
        json?: boolean;
        /** 从 inspect 选择的运行入口 ID。 */
        entry?: string;
      },
    ) => await run_power_command(options, async () => {
      const runtime_power_id = await new PowerManagement().action_target(power_id, options.entry);
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
          power_name: runtime_power_id,
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
          entry_id: runtime_power_id,
          action_name,
          ...(result?.data !== undefined ? { data: result.data } : {}),
          ...(result?.message ? { message: result.message } : {}),
          ...(!remote.success || result?.error ? { error: result?.error ?? remote.error } : {}),
        },
      });
    }));
}
