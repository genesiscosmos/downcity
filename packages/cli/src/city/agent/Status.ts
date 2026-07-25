/**
 * 查询后台 Agent 进程（daemon）状态。
 *
 * 对应命令：
 * - `city agent status [path]`
 */

import {
  diagnoseDaemonStaleReasons,
  isProcessAlive,
  readDaemonMeta,
  readDaemonPid,
} from "@/city/process/daemon/Manager.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { get_managed_agent } from "@/city/process/registry/ManagedAgentRepository.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

/**
 * daemon 状态查询入口。
 *
 * 状态规则（中文）
 * - 运行中：输出 pid / log / startedAt
 * - 已初始化但未运行：输出 not running
 * - 未初始化：提示执行 `city agent create`
 */
export async function statusCommand(target: DaemonTarget): Promise<void> {
  const missingInitFiles: string[] = [];

  if (!get_managed_agent(target.agent_id)) {
    missingInitFiles.push("global DB agent config");
  }

  const pid = await readDaemonPid(target.agent_id);

  if (pid && isProcessAlive(pid)) {
    const meta = await readDaemonMeta(target.agent_id);

    emitCliBlock({
      tone: "success",
      title: "Agent status",
      summary: "running",
      facts: [
        ["agent", target.agent_id],
        ["workspace", target.workspace_path],
        ...(meta?.started_at ? [["started at", meta.started_at]] : []),
        ...(missingInitFiles.length > 0
          ? [["warning", `missing init files: ${missingInitFiles.join(", ")}`]]
          : []),
      ].map(([label, value]) => ({ label, value })),
    });
    return;
  }

  if (pid) {
    const reasons = await diagnoseDaemonStaleReasons(target, pid);
    emitCliBlock({
      tone: "warning",
      title: "Agent status",
      summary: "stale",
      facts: [
        {
          label: "agent",
          value: target.agent_id,
        },
        {
          label: "reason",
          value: reasons.map((item) => item.message).join("; "),
        },
        {
          label: "fix",
          value: `city agent doctor ${target.agent_id} --fix`,
        },
      ],
    });
    return;
  }

  if (missingInitFiles.length > 0) {
    emitCliBlock({
      tone: "error",
      title: "Agent status",
      summary: "not initialized",
      facts: [
        {
          label: "agent",
          value: target.agent_id,
        },
        {
          label: "missing",
          value: missingInitFiles.join(", "),
        },
        {
          label: "fix",
          value: 'run "city agent create" first',
        },
      ],
    });
    return;
  }

  emitCliBlock({
    tone: "info",
    title: "Agent status",
    summary: "stopped",
    facts: [
      {
        label: "agent",
        value: target.agent_id,
      },
    ],
  });
}
