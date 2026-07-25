/**
 * 查询后台 Agent 进程（daemon）状态。
 *
 * 对应命令：
 * - `city agent status [path]`
 */

import path from "path";
import {
  diagnoseDaemonStaleReasons,
  isProcessAlive,
  readDaemonMeta,
  readDaemonPid,
} from "@/city/process/daemon/Manager.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { readAgentConfig } from "@/city/process/registry/AgentConfigStore.js";

/**
 * daemon 状态查询入口。
 *
 * 状态规则（中文）
 * - 运行中：输出 pid / log / startedAt
 * - 已初始化但未运行：输出 not running
 * - 未初始化：提示执行 `city agent create`
 */
export async function statusCommand(cwd: string = "."): Promise<void> {
  const project_root = path.resolve(cwd);
  const missingInitFiles: string[] = [];

  if (!readAgentConfig(project_root)) {
    missingInitFiles.push("global DB agent config");
  }

  const pid = await readDaemonPid(project_root);

  if (pid && isProcessAlive(pid)) {
    const meta = await readDaemonMeta(project_root);

    emitCliBlock({
      tone: "success",
      title: "Agent status",
      summary: "running",
      facts: [
        ["project", project_root],
        ...(meta?.startedAt ? [["started at", meta.startedAt]] : []),
        ...(missingInitFiles.length > 0
          ? [["warning", `missing init files: ${missingInitFiles.join(", ")}`]]
          : []),
      ].map(([label, value]) => ({ label, value })),
    });
    return;
  }

  if (pid) {
    const reasons = await diagnoseDaemonStaleReasons(project_root, pid);
    emitCliBlock({
      tone: "warning",
      title: "Agent status",
      summary: "stale",
      facts: [
        {
          label: "project",
          value: project_root,
        },
        {
          label: "reason",
          value: reasons.map((item) => item.message).join("; "),
        },
        {
          label: "fix",
          value: `city agent doctor ${project_root} --fix`,
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
          label: "project",
          value: project_root,
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
        label: "project",
        value: project_root,
      },
    ],
  });
}
