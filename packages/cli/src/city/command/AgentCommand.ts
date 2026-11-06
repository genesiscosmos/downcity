/**
 * CLI agent 命令装配。
 *
 * 关键点（中文）
 * - 统一承载 `city agent` 命令树，避免主入口继续混合 console 与 agent 两套语义。
 * - 只保留 agent 命令自身的校验与装配，不接管全局 CLI 初始化。
 */

import type { Command, Option } from "commander";
import { register_agent_resource_commands } from "./ResourceCommands.js";
import { runInteractiveCityManager } from "@/city/shared/CityManager.js";

import { run_resource_chat } from "../resources/ChatCommand.js";
import { createVersionBanner } from "@/shared/IndexSupport.js";
import { helpText, t } from "@/shared/CliLocale.js";

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

  register_agent_resource_commands(agent);

  agent
    .command("chat <agent_id>")
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
    .option("--new-session", "Create a new ordinary work Session")
    .option("--workspace <id>", "Registered Workspace ID")
    .option("--workspace-path <path>", "Registered Workspace path")
    .option("--category <category>", "chat or work", "work")
    .option("--message-file <path-or-dash>", "Read message from a UTF-8 file or stdin")
    .option("--request-id <id>", "Stable input idempotency key")
    .option("--no-wait", "Return after the host accepts the input")
    .option("--root <path>", "City data root")
    .option("--timeout <seconds>", "Operation timeout")
    .option("--json", t({ zh: "输出 JSON", en: "output JSON" }))
    .helpOption("--help", helpText())
    .action(async (agent_id: string, options: Record<string, unknown>) => await run_resource_chat(agent_id, options));

}
