/**
 * `city agent stop`：停止后台常驻的 Agent 进程（daemon）。
 *
 * 关键点（中文）
 * - 这是单个 agent 的生命周期命令，只停止目标项目的 daemon。
 * - 底层 stop 会同步清理 pid/meta，并把 City registry 中对应 agent 标记为 stopped。
 * - 若目标 agent 未运行，命令保持幂等，只输出 not running。
 */

import path from "path";
import { stopDaemonProcess } from "@/city/process/daemon/Manager.js";
import { emitCliBlock } from "@/shared/CliReporter.js";
import { resolveAgentId } from "@/shared/IndexSupport.js";

/**
 * stop 命令执行流程。
 *
 * 关键点（中文）
 * 1) 将输入路径解析为绝对项目路径
 * 2) 调用 daemon manager 停止进程组
 * 3) 用人类可读 block 输出 stopped / not running
 */
export async function stopCommand(cwd: string = "."): Promise<void> {
  const project_root = path.resolve(cwd);
  const result = await stopDaemonProcess({ project_root });
  emitCliBlock({
    tone: result.stopped ? "success" : "info",
    title: result.stopped ? "Agent daemon stopped" : "Agent daemon not running",
    summary: resolveAgentId(project_root),
    facts: [
      {
        label: "Project",
        value: project_root,
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
