/**
 * agent 列表与交互式选择辅助模块。
 *
 * 关键点（中文）
 * - 统一承接 `city agent list` 的 registry 展示逻辑。
 * - 统一承接 `city agent start` 在省略路径时的目标选择逻辑。
 * - 规则固定为：显式路径优先，其次当前目录已初始化，最后才进入交互选择。
 */

import { resolve } from "path";
import prompts from "@/city/tui/Prompts.js";
import { listManagedAgentEntries } from "@/city/process/registry/CityRegistry.js";
import type { ManagedAgentRegistryEntry } from "@/city/types/runtime/Platform.js";
import type {
  CliAgentPromptChoice,
  CliRegisteredAgentView,
  ResolveCliAgentStartTargetDecision,
  ResolveCliAgentStartTargetDecisionInput,
} from "@/city/agent/AgentSelectionTypes.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { CliError } from "@/shared/CliError.js";
import { resolveAgentId } from "@/shared/IndexSupport.js";
import { resolveRunningManagedAgents } from "@/city/shared/CityAgentRuntime.js";
import { readAgentConfig } from "@/city/process/registry/AgentConfigStore.js";

/**
 * 判断一个目录是否已经满足最小 agent 初始化条件。
 */
function isInitializedAgentProject(project_root: string): boolean {
  return Boolean(readAgentConfig(project_root));
}

/**
 * 将 registry entry 转换为 CLI 展示视图。
 */
function toCliRegisteredAgentView(
  entry: ManagedAgentRegistryEntry,
): CliRegisteredAgentView {
  const project_root = resolve(String(entry.project_root || "").trim() || ".");
  return {
    id: resolveAgentId(project_root),
    project_root,
    status: entry.status === "stopped" ? "stopped" : "running",
  };
}

/**
 * 读取当前 registry 中的已登记 agent 列表。
 */
export async function listRegisteredAgentsForCli(): Promise<CliRegisteredAgentView[]> {
  const entries = await listManagedAgentEntries();
  const runningViews = await resolveRunningManagedAgents({
    syncRegistry: false,
  });
  const runningProjectRoots = new Set(
    runningViews.map((item) => resolve(String(item.project_root || "").trim() || ".")),
  );
  return entries
    .map((entry) => {
      const view = toCliRegisteredAgentView(entry);
      return {
        ...view,
        status: runningProjectRoots.has(view.project_root) ? "running" : "stopped",
      } satisfies CliRegisteredAgentView;
    })
    .sort((left, right) => {
      // 关键点（中文）：运行中的 Agent 固定置顶，同状态内保持原有稳定排序。
      const status_priority = Number(right.status === "running") - Number(left.status === "running");
      return status_priority
        || left.id.localeCompare(right.id)
        || left.project_root.localeCompare(right.project_root);
    });
}

/**
 * 构建交互式选择器的 choices。
 */
export function buildCliAgentPromptChoices(
  agents: CliRegisteredAgentView[],
): CliAgentPromptChoice[] {
  return agents.map((agent) => ({
    title: agent.id,
    value: agent.project_root,
    description: `${agent.status} · ${agent.project_root}`,
  }));
}

/**
 * 解析 `agent start` 在当前上下文下应该如何决定目标目录。
 */
export function resolveCliAgentStartTargetDecision(
  input: ResolveCliAgentStartTargetDecisionInput,
): ResolveCliAgentStartTargetDecision {
  const explicitPath = String(input.pathInput || "").trim();
  if (explicitPath) {
    return {
      mode: "explicit",
      project_root: resolve(explicitPath),
    };
  }

  const currentWorkingDirectory = resolve(input.currentWorkingDirectory || ".");
  if (input.currentDirectoryInitialized) {
    return {
      mode: "current",
      project_root: currentWorkingDirectory,
    };
  }

  if (input.registeredAgents.length === 0) {
    return {
      mode: "error",
      reason: "no-registered-agents",
    };
  }

  if (!input.interactive) {
    return {
      mode: "error",
      reason: "non-interactive",
    };
  }

  return {
    mode: "prompt",
  };
}

/**
 * 通过终端交互让用户选择一个已登记 agent。
 */
async function promptRegisteredAgentProjectRoot(
  agents: CliRegisteredAgentView[],
): Promise<string | null> {
  const response = (await prompts({
    type: "select",
    name: "project_root",
    message: "选择要启动的 Agent",
    choices: buildCliAgentPromptChoices(agents),
    initial: 0,
  })) as { project_root?: string };

  const project_root = String(response.project_root || "").trim();
  return project_root || null;
}

/**
 * 输出已登记 agent 列表。
 */
export async function emitRegisteredAgentList(): Promise<void> {
  const agents = await listRegisteredAgentsForCli();
  const filteredAgents = agents;

  if (filteredAgents.length === 0) {
    emitCliBlock({
      tone: "info",
      title: "Agents",
      summary: "0 registered",
      note: "Run `city agent start <path>` once to register an agent with City.",
    });
    return;
  }

  emitCliList({
    tone: "accent",
    title: "Agents",
    summary: `${filteredAgents.length} registered`,
    items: filteredAgents.map((agent) => ({
      tone: agent.status === "running" ? "success" : "info",
      title: agent.id,
      facts: [
        {
          label: "Project",
          value: agent.project_root,
        },
        {
          label: "Status",
          value: agent.status,
        },
      ],
    })),
  });
}

/**
 * 输出已登记 agent 列表，可选仅显示运行中项目。
 */
export async function emitRegisteredAgentListWithOptions(options?: {
  /**
   * 是否只输出当前运行中的 agent。
   */
  runningOnly?: boolean;
  /**
   * 是否以 JSON 输出。
   */
  asJson?: boolean;
}): Promise<void> {
  const allAgents = await listRegisteredAgentsForCli();
  const agents = options?.runningOnly === true
    ? allAgents.filter((item) => item.status === "running")
    : allAgents;

  if (options?.asJson === true) {
    printResult({
      asJson: true,
      success: true,
      title: "agents",
      payload: {
        count: agents.length,
        runningOnly: options.runningOnly === true,
        agents,
      },
    });
    return;
  }

  if (agents.length === 0) {
    emitCliBlock({
      tone: "info",
      title: options?.runningOnly === true ? "Running agents" : "Agents",
      summary: options?.runningOnly === true ? "0 running" : "0 registered",
      note: options?.runningOnly === true
        ? "No agent daemon is currently running."
        : "Run `city agent start <path>` once to register an agent with City.",
    });
    return;
  }

  emitCliList({
    tone: "accent",
    title: options?.runningOnly === true ? "Running agents" : "Agents",
    summary: options?.runningOnly === true
      ? `${agents.length} running`
      : `${agents.length} registered`,
    items: agents.map((agent) => ({
      tone: agent.status === "running" ? "success" : "info",
      title: agent.id,
      facts: [
        {
          label: "Project",
          value: agent.project_root,
        },
        {
          label: "Status",
          value: agent.status,
        },
      ],
    })),
  });
}

/**
 * 为 `city agent start` 解析最终要启动的项目目录。
 */
export async function resolveCliAgentStartProjectRoot(
  pathInput?: string,
): Promise<string> {
  const currentWorkingDirectory = resolve(process.cwd());
  const registeredAgents = await listRegisteredAgentsForCli();
  const decision = resolveCliAgentStartTargetDecision({
    pathInput,
    currentWorkingDirectory,
    currentDirectoryInitialized: isInitializedAgentProject(currentWorkingDirectory),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    registeredAgents,
  });

  if (decision.mode === "explicit" || decision.mode === "current") {
    return decision.project_root;
  }

  if (decision.mode === "error") {
    if (decision.reason === "no-registered-agents") {
      throw new CliError({
        title: "No registered agents",
        fix: "city agent start <path>",
      });
    }

    throw new CliError({
      title: "Agent path is required",
      fix: "city agent start <path>",
    });
  }

  const selectedProjectRoot = await promptRegisteredAgentProjectRoot(registeredAgents);
  if (!selectedProjectRoot) {
    emitCliBlock({
      tone: "info",
      title: "Agent start cancelled",
    });
    throw new CliError({
      title: "Agent start cancelled",
      exitCode: 0,
    });
  }

  return selectedProjectRoot;
}
