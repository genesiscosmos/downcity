/**
 * CLI agent 命令装配。
 *
 * 关键点（中文）
 * - 统一承载 `city agent` 命令树，避免主入口继续混合 console 与 agent 两套语义。
 * - 只保留 agent 命令自身的校验与装配，不接管全局 CLI 初始化。
 */

import type { Command, Option } from "commander";
import {
  emit_registered_agent_list_with_options,
  resolve_cli_agent_id,
} from "@/city/agent/AgentSelection.js";
import { runInteractiveCityManager } from "@/city/shared/CityManager.js";
import { run_agent_create_command } from "@/city/agent/Init.js";
import { configure_agent_model } from "@/city/agent/AgentModel.js";
import { chatCommand } from "@/city/agent/AgentChat.js";
import type { AgentChatCliOptions } from "@/city/agent/AgentChatTypes.js";
import type { AgentModelCommandOptions } from "@/city/types/AgentModel.js";
import { createVersionBanner, parseBoolean } from "@/shared/IndexSupport.js";
import { helpText, t } from "@/shared/CliLocale.js";
import { registerAgentTokenCommand } from "@/city/command/TokenCommand.js";

/**
 * agent 命令注册参数。
 */
export interface AgentCommandRegistrationContext {
  /** 当前 CLI 版本号。 */
  version: string;
  /** 当前 city 绑定的 agent runtime 版本号。 */
  agentVersion: string;
  /** commander 的隐藏 Option 构造器。 */
  hiddenPortOption: typeof Option;
}

/**
 * 注册 `city agent` 命令组。
 */
export function registerAgentCommands(
  program: Command,
  context: AgentCommandRegistrationContext,
): void {
  const agent = program
    .command("agent")
    .description(t({
      zh: "管理 Agent、Workspace、Sessions 与配置（无参数时打开交互式界面）",
      en: "manage Agents, Workspaces, Sessions, and configuration (opens the interactive UI without arguments)",
    }))
    .version(`city ${context.version} (agent ${context.agentVersion})`, "-v, --version")
    .helpOption("--help", helpText())
    .action(createVersionBanner(context.version, async () => {
      if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
        await runInteractiveCityManager({ program });
        return;
      }
      agent.outputHelp();
    }));

  agent
    .command("create [path]")
    .description(t({
      zh: "创建 Agent 并初始化 Workspace 资产",
      en: "create an Agent and initialize its Workspace assets",
    }))
    .option("-f, --force [enabled]", t({
      zh: "允许覆盖已有 Agent 配置（危险操作）",
      en: "allow overwriting existing Agent config (dangerous)",
    }), parseBoolean)
    .helpOption("--help", helpText())
    .action(createVersionBanner(context.version, async (workspace_path: string | undefined, options: { force?: boolean }) => {
      await run_agent_create_command(workspace_path, options);
    }));

  agent
    .command("list")
    .description(t({
      zh: "列出已登记的 Agent",
      en: "list registered Agents",
    }))
    .option("--running [enabled]", t({
      zh: "仅列出当前 CLI City 持有的 Agent",
      en: "list only Agents currently held by the CLI City",
    }), parseBoolean)
    .option("--json [enabled]", t({
      zh: "以 JSON 输出",
      en: "output as JSON",
    }), parseBoolean)
    .helpOption("--help", helpText())
    .action(createVersionBanner(
      context.version,
      async (options: { running?: boolean; json?: boolean }) => {
        await emit_registered_agent_list_with_options({
          running_only: options.running === true,
          as_json: options.json === true,
        });
      },
    ));

  agent
    .command("model [agent_id]")
    .description(t({
      zh: "配置 Agent 默认模型",
      en: "configure the Agent default model",
    }))
    .option("--set <model-id>", t({
      zh: "直接设置 Federation model id",
      en: "set a Federation model id",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(
      context.version,
      async (agent_id: string | undefined, options: AgentModelCommandOptions) => {
        await configure_agent_model(await resolve_cli_agent_id(agent_id), options);
      },
    ));

  agent
    .command("chat [agent_id]")
    .description(t({
      zh: "进入 Agent 的 Session 对话",
      en: "open an Agent Session for chat",
    }))
    .option("-m, --message <text>", t({
      zh: "发送一次性消息",
      en: "send a one-shot message",
    }))
    .option("--session-id <id>", t({
      zh: "进入指定 Session",
      en: "use a specific Session",
    }))
    .option("--new-session [enabled]", t({
      zh: "创建新 Session",
      en: "create a new Session",
    }), parseBoolean)
    .option("--workspace <id-or-path>", t({
      zh: "指定本次对话使用的 Workspace ID 或路径",
      en: "select the Workspace ID or path for this chat",
    }))
    .option("--json [enabled]", t({ zh: "输出 JSON", en: "output JSON" }), parseBoolean)
    .helpOption("--help", helpText())
    .action(createVersionBanner(
      context.version,
      async (agent_id: string | undefined, options: AgentChatCliOptions) => {
        await chatCommand({ ...options, to: agent_id });
      },
    ));

  registerAgentTokenCommand(agent);
}
