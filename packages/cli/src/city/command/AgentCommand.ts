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
  resolve_cli_agent_target,
} from "@/city/agent/AgentSelection.js";
import { runInteractiveAgentManager } from "@/city/agent/AgentManager.js";
import { initCommand } from "@/city/agent/Init.js";
import { restartCommand } from "@/city/agent/Restart.js";
import { stopCommand } from "@/city/agent/Stop.js";
import { runCommand } from "@/city/agent/Run.js";
import { startCommand } from "@/city/agent/Start.js";
import { statusCommand } from "@/city/agent/Status.js";
import { configure_agent_model } from "@/city/agent/AgentModel.js";
import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import type { AgentModelCommandOptions } from "@/city/types/AgentModel.js";
import { createVersionBanner, inject_agent_context, parseBoolean, parsePort } from "@/shared/IndexSupport.js";
import { runWithSpinner } from "@/city/utils/cli/Spinner.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import {
  cleanupStaleDaemonFiles,
  diagnoseDaemonStaleReasons,
  isProcessAlive as isDaemonProcessAlive,
  readDaemonPid,
} from "@/city/process/daemon/Manager.js";
import { prepareForegroundAgent } from "@/city/shared/CityAgentRuntime.js";
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
      zh: "管理 Agent：创建/列出/启停/重启（无参数时启动交互式管理器）",
      en: "manage agents: create, list, start, stop, and restart (opens the interactive manager when used without arguments)",
    }))
    .version(`city ${context.version} (agent ${context.agentVersion})`, "-v, --version")
    .helpOption("--help", helpText())
    .action(createVersionBanner(context.version, async () => {
      if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
        await runInteractiveAgentManager();
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
    .action(createVersionBanner(context.version, async (cwd: string = ".", options: { force?: boolean }) => {
      await initCommand(cwd, options);
    }));

  agent
    .command("list")
    .description(t({
      zh: "列出已登记到 City 的全局 Agent",
      en: "list global Agents registered in City",
    }))
    .option("--running [enabled]", t({
      zh: "仅列出当前运行中的 Agent",
      en: "list only currently running agents",
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
    .command("start [agent_id]")
    .description(t({
      zh: "启动 Agent 进程（后台/前台）",
      en: "start an Agent process in the background or foreground",
    }))
    .addOption(new context.hiddenPortOption("--port <port>").argParser(parsePort).hideHelp())
    .addOption(new context.hiddenPortOption("--rpc-port <port>").argParser(parsePort).hideHelp())
    .option("-h, --host <host>", t({
      zh: "服务主机（默认 127.0.0.1）",
      en: "service host (default: 127.0.0.1)",
    }))
    .option("--foreground [enabled]", t({
      zh: "前台启动（仅当前终端）",
      en: "run in the foreground for the current terminal only",
    }), parseBoolean)
    .helpOption("--help", helpText())
    .action(
      createVersionBanner(
        context.version,
        async (agent_id: string | undefined, options: AgentStartOptions & { foreground?: boolean }) => {
          const target = await resolve_cli_agent_target(agent_id);
          const prepared = await prepareForegroundAgent(target, options);
          if (prepared.should_foreground) {
            await runCommand(prepared.target, prepared.options);
            return;
          }
          await startCommand(prepared.target, prepared.options);
        },
      ),
    );

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
        const target = await resolve_cli_agent_target(agent_id);
        await configure_agent_model(target.agent_id, options);
      },
    ));

  agent
    .command("status [agent_id]")
    .description(t({
      zh: "查看后台 Agent 进程（daemon）状态",
      en: "show background Agent daemon status",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(context.version, async (agent_id: string | undefined) => {
      const target = await resolve_cli_agent_target(agent_id);
      inject_agent_context(target);
      await statusCommand(target);
    }));

  agent
    .command("doctor [agent_id]")
    .description(t({
      zh: "诊断 daemon 状态文件；可选修复僵尸 pid/meta",
      en: "diagnose daemon state files and optionally clean stale pid/meta data",
    }))
    .option("--fix [enabled]", t({
      zh: "清理僵尸 daemon 状态文件",
      en: "clean stale daemon state files",
    }), parseBoolean)
    .helpOption("--help", helpText())
    .action(createVersionBanner(
      context.version,
      async (agent_id: string | undefined, options: { fix?: boolean }) => {
        const target = await resolve_cli_agent_target(agent_id);
        inject_agent_context(target);
        const pid = await readDaemonPid(target.agent_id);

        if (!pid) {
          emitCliBlock({
            tone: "success",
            title: "No daemon state found",
            facts: [
              {
                label: "Agent",
                value: target.agent_id,
              },
            ],
          });
          return;
        }

        if (isDaemonProcessAlive(pid)) {
          emitCliBlock({
            tone: "success",
            title: "Daemon process is alive",
            facts: [
              {
                label: "Agent",
                value: target.agent_id,
              },
            ],
          });
          return;
        }

        const staleReasons = await diagnoseDaemonStaleReasons(target, pid);
        emitCliBlock({
          tone: "warning",
          title: "Stale daemon state detected",
          facts: [
            {
              label: "Agent",
              value: target.agent_id,
            },
            {
              label: "Reason",
              value: staleReasons.map((item) => item.message).join("; "),
            },
          ],
        });

        if (options.fix !== true) {
          emitCliBlock({
            tone: "info",
            title: "Suggested fix",
            facts: [
              {
                label: "Command",
                value: "city agent doctor <agent_id> --fix",
              },
            ],
          });
          return;
        }

        await runWithSpinner(
          () => cleanupStaleDaemonFiles(target.agent_id),
          { text: "Cleaning stale daemon files..." },
        );
        emitCliBlock({
          tone: "success",
          title: "Cleaned stale daemon state",
          facts: [
            {
              label: "Agent",
              value: target.agent_id,
            },
          ],
        });
      },
    ));

  agent
    .command("stop [agent_id]")
    .description(t({
      zh: "停止后台 Agent 进程（daemon）",
      en: "stop the background Agent daemon",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(context.version, async (agent_id: string | undefined) => {
      const target = await resolve_cli_agent_target(agent_id);
      inject_agent_context(target);
      await stopCommand(target);
    }));

  agent
    .command("restart [agent_id]")
    .description(t({
      zh: "重启后台 Agent 进程（daemon）",
      en: "restart the background Agent daemon",
    }))
    .option("-h, --host <host>", t({
      zh: "服务主机（默认 127.0.0.1）",
      en: "service host (default: 127.0.0.1)",
    }))
    .helpOption("--help", helpText())
    .action(createVersionBanner(context.version, async (agent_id: string | undefined, options: AgentStartOptions) => {
      const target = await resolve_cli_agent_target(agent_id);
      inject_agent_context(target);
      await restartCommand(target, options);
    }));

  registerAgentTokenCommand(agent);
}
