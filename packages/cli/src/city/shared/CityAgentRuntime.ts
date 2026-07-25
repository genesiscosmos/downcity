/**
 * City Agent runtime 辅助模块。
 *
 * 关键点（中文）
 * - City 根命令不再拥有常驻 runtime；这里只保留 Agent 列表与前台启动装配逻辑。
 * - City 管理命令仍通过 `city` 入口负责。
 */

import { resolve } from "node:path";
import type { ManagedAgentProcessView } from "@/city/types/runtime/Platform.js";
import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import { allocateAvailablePort } from "@/city/process/daemon/PortAllocator.js";
import {
  getDaemonLogPath,
  isProcessAlive as isDaemonProcessAlive,
  readDaemonPid,
} from "@/city/process/daemon/Manager.js";
import {
  listManagedAgentEntries,
} from "@/city/process/registry/CityRegistry.js";
import { CliError } from "@/shared/CliError.js";
import { inject_agent_context } from "@/shared/IndexSupport.js";
import { checkAgentPreflight } from "@/city/shared/PluginTargetSupport.js";

/**
 * 解析当前仍在运行的 managed agent。
 */
export async function resolveRunningManagedAgents(_params?: {
  /**
   * 是否在扫描过程中回写 registry。
   *
   * @deprecated 当前状态只由 daemon pid/meta 推导，不再写 registry 状态。
   */
  syncRegistry?: boolean;
}): Promise<ManagedAgentProcessView[]> {
  const entries = await listManagedAgentEntries();
  const views: ManagedAgentProcessView[] = [];

  for (const entry of entries) {
    if (entry.status !== "running") continue;
    const project_root = resolve(String(entry.project_root || "").trim() || ".");
    const daemon_pid = await readDaemonPid(project_root);
    if (!daemon_pid || !isDaemonProcessAlive(daemon_pid)) {
      continue;
    }

    views.push({
      project_root: project_root,
      registeredPid: daemon_pid,
      daemonPid: daemon_pid,
      running: true,
      startedAt: entry.startedAt,
      updated_at: entry.updated_at,
      logPath: getDaemonLogPath(project_root),
    });
  }

  return views.sort((left, right) => left.project_root.localeCompare(right.project_root));
}

/**
 * 确认目标 agent 已登记到 City registry。
 */
export async function ensureRegisteredAgentProjectRoot(cwd: string): Promise<string> {
  const project_root = resolve(String(cwd || "."));
  const entries = await listManagedAgentEntries();
  const matched = entries.some(
    (entry) => resolve(String(entry.project_root || "").trim() || ".") === project_root,
  );
  if (matched) return project_root;

  throw new CliError({
    title: "Agent is not registered in managed agent registry",
    note: `project: ${project_root}`,
    fix: "city agent start <path>",
  });
}

/**
 * 为前台 agent 运行补齐上下文与模型绑定。
 */
export async function prepareForegroundAgent(
  cwd: string,
  options: AgentStartOptions & { foreground?: boolean },
): Promise<{
  project_root: string;
  options: AgentStartOptions & { foreground?: boolean };
  shouldForeground: boolean;
}> {
  inject_agent_context(cwd);
  const project_root = resolve(String(cwd || "."));
  await checkAgentPreflight(project_root);

  const should_foreground = options.foreground === true;
  if (!should_foreground) {
    return {
      project_root: project_root,
      options,
      shouldForeground: false,
    };
  }

  const host = String(options.host || "0.0.0.0").trim() || "0.0.0.0";
  const foreground_port =
    options.port !== undefined && options.port !== null && options.port !== ""
      ? options.port
      : await allocateAvailablePort({ host });

  return {
    project_root: project_root,
    shouldForeground: true,
    options: {
      ...options,
      host,
      port: foreground_port,
    },
  };
}
