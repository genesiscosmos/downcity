/**
 * City Agent runtime 辅助模块。
 *
 * 关键点（中文）
 * - City 根命令不再拥有常驻 runtime；这里只保留 Agent 列表与前台启动装配逻辑。
 * - City 管理命令仍通过 `city` 入口负责。
 */

import type { ManagedAgentProcessView } from "@/city/types/runtime/Platform.js";
import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import { allocateAvailablePort } from "@/city/process/daemon/PortAllocator.js";
import {
  getDaemonLogPath,
  isProcessAlive as isDaemonProcessAlive,
  readDaemonMeta,
  readDaemonPid,
} from "@/city/process/daemon/Manager.js";
import { inject_agent_context } from "@/shared/IndexSupport.js";
import { checkAgentPreflight } from "@/city/shared/PluginTargetSupport.js";
import { list_managed_agents } from "@/city/process/registry/ManagedAgentRepository.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

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
  const entries = list_managed_agents();
  const views: ManagedAgentProcessView[] = [];

  for (const entry of entries) {
    const daemon_pid = await readDaemonPid(entry.agent_id);
    if (!daemon_pid || !isDaemonProcessAlive(daemon_pid)) {
      continue;
    }
    const meta = await readDaemonMeta(entry.agent_id);
    if (!meta) continue;

    views.push({
      agent_id: entry.agent_id,
      workspace_path: meta.workspace_path,
      daemon_pid,
      running: true,
      started_at: meta?.started_at ?? "",
      updated_at: entry.updated_at,
      log_path: getDaemonLogPath(entry.agent_id),
    });
  }

  return views.sort((left, right) => left.agent_id.localeCompare(right.agent_id));
}

/**
 * 为前台 agent 运行补齐上下文与模型绑定。
 */
export async function prepareForegroundAgent(
  target: DaemonTarget,
  options: AgentStartOptions & { foreground?: boolean },
): Promise<{
  target: DaemonTarget;
  options: AgentStartOptions & { foreground?: boolean };
  should_foreground: boolean;
}> {
  const should_foreground = options.foreground === true;
  if (!should_foreground) {
    return {
      target,
      options,
      should_foreground: false,
    };
  }

  inject_agent_context(target);
  await checkAgentPreflight(target);

  const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
  const foreground_port =
    options.port !== undefined && options.port !== null && options.port !== ""
      ? options.port
      : await allocateAvailablePort({ host });

  return {
    target,
    should_foreground: true,
    options: {
      ...options,
      host,
      port: foreground_port,
    },
  };
}
