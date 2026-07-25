/**
 * `city plugin` 运行态命令共享辅助 + Agent 预检。
 *
 * 关键点（中文）
 * - 统一承载 plugin runtime 命令的参数解析、目标 agent 路径解析与项目目录校验。
 * - 提供 `checkAgentPreflight` 供 start/restart/status 等命令统一使用。
 * - Agent 命令不依赖 top-level city 常驻进程；长期运行边界只在 Agent daemon。
 * - 保持 command 注册层只关注命令树，不再直接承载路径解析细节。
 */

import path from "node:path";
import type { JsonValue } from "@downcity/agent";
import { CliError } from "@/shared/CliError.js";
import type { ActionScheduleJobStatus } from "@downcity/agent";
import type { PluginCliBaseOptions } from "@downcity/agent";
import { create_platform_sandbox } from "@/city/sandbox/PlatformSandbox.js";
import {
  get_managed_agent,
  list_managed_agents_by_workspace,
} from "@/city/process/registry/ManagedAgentRepository.js";
import { ensure_agent_execution_model_ready } from "@/city/agent/AgentExecutionModelRecovery.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

/**
 * Agent 启动前预检选项。
 */
export interface AgentPreflightOptions {
  /** 是否检查 shell sandbox 宿主依赖。 */
  requireShellSandbox?: boolean;
}

function formatSandboxFixes(fixes: string[]): string {
  return fixes.map((item) => `- ${item}`).join("\n");
}

/**
 * 检查本机 shell sandbox 依赖。
 */
export async function checkShellSandboxHostPreflight(): Promise<void> {
  const sandbox = await create_platform_sandbox();
  const result = await sandbox.preflight();
  if (result.ok) return;

  const note = result.issues.map((issue) => issue.message).join("\n");
  const fixes = result.issues.flatMap((issue) => issue.fixes);
  const fixLines = fixes.length > 0 ? [formatSandboxFixes(fixes)] : [];
  throw new CliError({
    title: "Shell sandbox is not ready",
    note,
    fix: [
      ...fixLines,
      "Downcity will not run shell commands without a sandbox backend.",
    ].join("\n"),
  });
}

/**
 * Agent 启动前统一预检。
 *
 * 关键点（中文）
 * - 收敛 start/restart/status 等命令的前置校验逻辑。
 * - 按顺序检查，首个失败即抛 CliError（sandbox → DB config → binding）。
 *
 * @throws {CliError} 任一校验失败时抛出。
 */
export async function checkAgentPreflight(
  target: DaemonTarget,
  options?: AgentPreflightOptions,
): Promise<void> {
  if (options?.requireShellSandbox !== false) {
    await checkShellSandboxHostPreflight();
  }

  const agent = get_managed_agent(target.agent_id);
  if (!agent || path.resolve(agent.workspace_path) !== path.resolve(target.workspace_path)) {
    throw new CliError({
      title: "Agent target is not managed",
      note: `${target.agent_id} → ${target.workspace_path}`,
      fix: "city agent list",
    });
  }

  // 关键点（中文）：失配时由 TTY 选择器恢复模型，避免切换 Federation 后只能手工修配置。
  await ensure_agent_execution_model_ready(target.agent_id);
}

/**
 * 解析正整数参数。
 */
export function parsePositiveIntOption(value: string, fieldName: string): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return parsed;
}

/**
 * 归一化 schedule 状态过滤参数。
 */
export function normalizeScheduledJobStatus(
  value: string | undefined,
): ActionScheduleJobStatus | undefined {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return undefined;
  if (
    text === "pending" ||
    text === "running" ||
    text === "succeeded" ||
    text === "failed" ||
    text === "cancelled"
  ) {
    return text;
  }
  throw new Error(
    `Invalid schedule status: ${value}. Use pending|running|succeeded|failed|cancelled.`,
  );
}

/**
 * 解析项目根目录。
 */
export function resolveProjectRoot(pathInput?: string): string {
  const raw = String(pathInput || ".").trim() || ".";
  // 关键点（中文）：在 agent shell 中，默认 path="." 时优先使用注入的 DC_AGENT_PATH。
  if (raw === ".") {
    const envAgentPath = String(process.env.DC_AGENT_PATH || "").trim();
    if (envAgentPath) return path.resolve(envAgentPath);
  }
  return path.resolve(raw);
}

/**
 * 通过 agent id 解析 project_root。
 */
export async function resolveProjectRootByAgentId(agent_id: string): Promise<{
  agent_id?: string;
  project_root?: string;
  error?: string;
}> {
  const target = String(agent_id || "").trim().toLowerCase();
  if (!target) {
    return { error: "--agent requires a non-empty value" };
  }

  const agent = get_managed_agent(target);
  if (!agent) {
    return {
      error: `Agent not found: ${agent_id}. Run "city agent list" to inspect ids.`,
    };
  }
  return { agent_id: agent.agent_id, project_root: agent.workspace_path };
}

/**
 * 统一解析 plugin runtime 命令目标路径（agent 优先于 path）。
 */
export async function resolvePluginProjectRoot(options: PluginCliBaseOptions): Promise<{
  agent_id?: string;
  project_root?: string;
  error?: string;
}> {
  const explicitAgent = String(options.agent || "").trim();
  if (explicitAgent) {
    return resolveProjectRootByAgentId(explicitAgent);
  }

  const rawPath = String(options.path || ".").trim() || ".";
  // 关键点（中文）：在 agent shell 中，未显式传 --agent 且 path 走默认值时，
  // 优先使用注入的 DC_AGENT_ID 走 registry 解析，确保多 agent 下目标稳定。
  if (rawPath === ".") {
    const envAgentId = String(process.env.DC_AGENT_ID || "").trim();
    if (envAgentId) {
      const byId = await resolveProjectRootByAgentId(envAgentId);
      if (byId.project_root) {
        return byId;
      }
    }
  }

  const project_root = resolveProjectRoot(options.path);
  const agents = list_managed_agents_by_workspace(project_root);
  if (agents.length === 0) {
    return {
      error:
        `Agent is not registered in managed agent registry: ${project_root}. ` +
        `Run "city agent list" to inspect registered agents.`,
    };
  }
  if (agents.length > 1) {
    return {
      error: `Workspace is bound to multiple agents. Pass --agent with one of: ${agents.map((agent) => agent.agent_id).join(", ")}`,
    };
  }
  return { agent_id: agents[0].agent_id, project_root };
}

/**
 * 解析 ActionSchedule 管理命令目标路径。
 */
export async function resolvePluginScheduleProjectRoot(options: PluginCliBaseOptions): Promise<{
  agent_id?: string;
  project_root?: string;
  error?: string;
}> {
  const explicitAgent = String(options.agent || "").trim();
  if (explicitAgent) {
    return resolveProjectRootByAgentId(explicitAgent);
  }
  const project_root = resolveProjectRoot(options.path);
  const agents = list_managed_agents_by_workspace(project_root);
  return agents.length === 1
    ? { agent_id: agents[0].agent_id, project_root }
    : { project_root, error: agents.length === 0
      ? `Agent not found for Workspace: ${project_root}`
      : `Workspace is bound to multiple agents. Pass --agent with one of: ${agents.map((agent) => agent.agent_id).join(", ")}` };
}

/**
 * 校验路径是否为有效 agent 项目目录。
 */
export function validateAgentProjectRoot(project_root: string): string | null {
  return String(project_root || "").trim()
    ? null
    : "Agent Workspace path is required.";
}

/**
 * 解析 plugin command payload。
 */
export function parseCommandPayload(raw?: string): JsonValue | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    // 关键点（中文）：payload 不是 JSON 时按字符串透传，避免强制格式。
    return text;
  }
}
