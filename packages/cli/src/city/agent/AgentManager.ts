/**
 * `city agent` 交互式管理器入口。
 *
 * 关键点（中文）
 * - 裸 `city agent` 在交互式终端里进入这里，而不是只输出静态 help。
 * - 保留原有脚本化子命令不变，只把高频的人类操作收敛成轻量 manager。
 */

import { emitCliBlock } from "@/shared/CliReporter.js";
import {
  isInteractiveTerminal,
  loadAgentSummaries,
  promptAgentListSelection,
  runCreateFlow,
  runSelectedAgentManager,
} from "@/city/agent/AgentManagerHelpers.js";

/**
 * 运行 `city agent` 交互式管理器。
 */
export async function runInteractiveAgentManager(): Promise<void> {
  if (!isInteractiveTerminal()) return;

  let last_message = "";
  while (true) {
    const selection = await promptAgentListSelection(last_message);
    last_message = "";
    if (!selection || selection.type === "exit") {
      emitCliBlock({
        tone: "info",
        title: "Agent manager closed",
      });
      return;
    }

    try {
      if (selection.type === "create") {
        await runCreateFlow();
        last_message = "Agent 创建流程已结束";
        continue;
      }
      if (selection.type === "agent") {
        const agents = await loadAgentSummaries();
        const agent = agents.find((item) => item.project_root === selection.project_root);
        if (!agent) {
          last_message = `Agent 不存在：${selection.project_root}`;
          continue;
        }
        await runSelectedAgentManager(agent);
        last_message = `已返回 Agent 列表`;
      }
    } catch (error) {
      last_message = `操作失败：${format_agent_manager_error(error)}`;
    }
  }
}

function format_agent_manager_error(error: unknown): string {
  if (error && typeof error === "object" && "note" in error) {
    const note = String((error as { note?: unknown }).note ?? "").trim();
    if (note) return note;
  }
  return error instanceof Error ? error.message : String(error);
}
