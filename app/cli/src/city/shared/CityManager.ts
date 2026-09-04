/**
 * `city` 裸命令交互式首页。
 *
 * 关键点（中文）
 * - 裸 `city` 直接打开 Agent 列表，不保留额外的 City Dashboard。
 * - Federation 与全局 Plugin 管理直接放在 Agents 首页的设置分组。
 * - CLI City daemon 生命周期继续由显式根命令拥有。
 */

import {
  runInteractiveAgentManager,
  type agent_list_city_action,
} from "@/city/agent/AgentManager.js";
import { runInteractivePluginManager } from "@/city/command/PluginCommand.js";
import { run_interactive_federation_manager } from "@/city/shared/FederationConnection.js";
import { promptAndPersistCityCliLocale } from "@/city/shared/InteractiveLocale.js";

interface CityHelpProgram {
  /** 输出当前 City 根命令帮助。 */
  outputHelp: () => void;
}

/**
 * 运行 `city` 裸命令交互式首页。
 */
export async function runInteractiveCityManager(params: {
  /**
   * City 根命令帮助输出器。
   */
  program: CityHelpProgram;
}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    params.program.outputHelp();
    return;
  }

  await runInteractiveAgentManager({
    run_city_action: async (action) => await run_city_list_action(action, params.program),
  });
}

async function run_city_list_action(
  action: agent_list_city_action,
  program: CityHelpProgram,
): Promise<void> {
  if (action === "federation") await run_interactive_federation_manager();
  if (action === "plugins") await runInteractivePluginManager();
  if (action === "language") await promptAndPersistCityCliLocale();
  if (action === "help") program.outputHelp();
}
