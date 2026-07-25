/**
 * `city agent stop`：停止后台常驻的 Agent 进程（daemon）。
 *
 * 关键点（中文）
 * - 这是单个 agent 的生命周期命令，只停止目标项目的 daemon。
 * - 底层 stop 会同步清理 pid/meta，并把 City registry 中对应 agent 标记为 stopped。
 * - 若目标 agent 未运行，命令保持幂等，只输出 not running。
 */

import { stopDaemonProcess } from "@/city/process/daemon/Manager.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";

/**
 * stop 命令执行流程。
 *
 * 关键点（中文）
 * 1) 将输入路径解析为绝对项目路径
 * 2) 调用 daemon manager 停止进程组
 * 3) 用人类可读 block 输出 stopped / not running
 */
export async function stopCommand(target: DaemonTarget): Promise<void> {
  const result = await stopDaemonProcess(target);
  emitCliBlock({
    tone: result.stopped ? "success" : "info",
    title: result.stopped ? "Agent daemon stopped" : "Agent daemon not running",
    summary: target.agent_id,
    facts: [
      {
        label: "Workspace",
        value: target.workspace_path,
      },
      ...(result.pid
        ? [
            {
              label: "PID",
              value: String(result.pid),
            },
          ]
        : []),
    ],
  });
}
