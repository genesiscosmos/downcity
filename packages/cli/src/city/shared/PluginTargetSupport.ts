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
import { listManagedAgentEntries } from "@/city/process/registry/CityRegistry.js";
import type { JsonValue } from "@downcity/agent";
import { resolveAgentId } from "@/shared/IndexSupport.js";
import { CliError } from "@/shared/CliError.js";
import type { ActionScheduleJobStatus } from "@downcity/agent";
import type { PluginCliBaseOptions } from "@downcity/agent";
import { create_platform_sandbox } from "@/city/sandbox/PlatformSandbox.js";
import { readAgentConfig } from "@/city/process/registry/AgentConfigStore.js";
import { ensure_project_execution_model_ready } from "@/city/agent/AgentExecutionModelRecovery.js";

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
  project_root: string,
  options?: AgentPreflightOptions,
): Promise<void> {
  if (options?.requireShellSandbox !== false) {
    await checkShellSandboxHostPreflight();
  }

  if (!readAgentConfig(project_root)) {
    throw new CliError({
      title: "Project not initialized",
      note: `Agent config not found in the global DB: ${project_root}`,
      fix: "city agent create",
    });
  }

  // 关键点（中文）：失配时由 TTY 选择器恢复模型，避免切换 Federation 后只能手工修配置。
  await ensure_project_execution_model_ready(project_root);
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
  project_root?: string;
  error?: string;
}> {
  const target = String(agent_id || "").trim().toLowerCase();
  if (!target) {
    return { error: "--agent requires a non-empty value" };
  }

  const entries = await listManagedAgentEntries();
  const matchedRoots = entries
    .map((entry) => path.resolve(String(entry.project_root || "").trim() || "."))
    .filter((root, index, all) => all.indexOf(root) === index)
    .filter((root) => {
      const byDirName = path.basename(root).toLowerCase() === target;
      const byProjectId = resolveAgentId(root).toLowerCase() === target;
      return byDirName || byProjectId;
    });

  if (matchedRoots.length === 0) {
    return {
      error: `Agent not found in managed agent registry: ${agent_id}. Run "city agent list" to inspect ids.`,
    };
  }
  if (matchedRoots.length > 1) {
    return {
      error: `Agent id is ambiguous: ${agent_id}. Matched paths: ${matchedRoots.join(", ")}`,
    };
  }

  return { project_root: matchedRoots[0] };
}

/**
 * 统一解析 plugin runtime 命令目标路径（agent 优先于 path）。
 */
export async function resolvePluginProjectRoot(options: PluginCliBaseOptions): Promise<{
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
  const entries = await listManagedAgentEntries();
  const registered = entries.some(
    (entry) =>
      path.resolve(String(entry.project_root || "").trim() || ".") === project_root,
  );
  if (!registered) {
    return {
      error:
        `Agent is not registered in managed agent registry: ${project_root}. ` +
        `Run "city agent list" to inspect registered agents.`,
    };
  }
  return { project_root };
}

/**
 * 解析 ActionSchedule 管理命令目标路径。
 */
export async function resolvePluginScheduleProjectRoot(options: PluginCliBaseOptions): Promise<{
  project_root?: string;
  error?: string;
}> {
  const explicitAgent = String(options.agent || "").trim();
  if (explicitAgent) {
    return resolveProjectRootByAgentId(explicitAgent);
  }
  return {
    project_root: resolveProjectRoot(options.path),
  };
}

/**
 * 校验路径是否为有效 agent 项目目录。
 */
export function validateAgentProjectRoot(project_root: string): string | null {
  if (readAgentConfig(project_root)) return null;
  return `Invalid agent path: ${project_root}. Missing global DB agent config.`;
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
