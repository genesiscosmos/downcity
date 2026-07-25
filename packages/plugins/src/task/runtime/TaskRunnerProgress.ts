/**
 * TaskRunnerProgress：task runner 进度与文本辅助模块。
 *
 * 关键点（中文）
 * - 收敛 progress 快照写入与文本裁剪等辅助能力。
 * - 这些逻辑与主执行流程正交，拆出后可让 Runner 主链更清晰。
 */

import fs from "fs-extra";
import type {
  ShipTaskKind,
  ShipTaskRunProgressEventV1,
  ShipTaskRunProgressV1,
  ShipTaskRunTriggerV1,
} from "@/task/types/Task.js";
import type { RunProgressSnapshot } from "@/task/runtime/TaskRunnerTypes.js";

/**
 * 把相对路径渲染为 markdown 行内链接文本。
 */
export function toMdLink(relPath: string): string {
  const p = String(relPath || "").trim();
  return p ? `\`${p}\`` : "";
}

/**
 * 文本摘要裁剪。
 */
export function summarizeText(text: string, maxChars: number): string {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}

/**
 * 将任意对象序列化为调试快照文本。
 */
export function serializeDebugSnapshot(value: unknown, maxChars = 40_000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return summarizeText(text, maxChars);
  } catch {
    return summarizeText(String(value), maxChars);
  }
}

/**
 * 持续写入运行进度快照（run-progress.json）。
 */
export function createRunProgressWriter(params: {
  progressJsonPath: string;
  taskId: string;
  timestamp: string;
  trigger: ShipTaskRunTriggerV1;
  kind: ShipTaskKind;
  startedAt: number;
}) {
  const events: ShipTaskRunProgressEventV1[] = [];
  let current: RunProgressSnapshot = {
    status: "running",
    phase: "preparing",
    message: "Task has been awakened; preparing the execution environment.",
  };

  const persist = async (): Promise<void> => {
    const now = Date.now();
    const payload: ShipTaskRunProgressV1 = {
      v: 1,
      taskId: params.taskId,
      timestamp: params.timestamp,
      trigger: params.trigger,
      kind: params.kind,
      status: current.status,
      phase: current.phase,
      message: current.message,
      startedAt: params.startedAt,
      updated_at: now,
      ...(typeof current.endedAt === "number" ? { endedAt: current.endedAt } : {}),
      ...(current.runStatus ? { runStatus: current.runStatus } : {}),
      ...(current.executionStatus ? { executionStatus: current.executionStatus } : {}),
      ...(current.resultStatus ? { resultStatus: current.resultStatus } : {}),
      ...(typeof current.round === "number" ? { round: current.round } : {}),
      ...(typeof current.maxRounds === "number" ? { maxRounds: current.maxRounds } : {}),
      events: [...events],
    };
    try {
      await fs.writeJson(params.progressJsonPath, payload, { spaces: 2 });
    } catch {
      // ignore
    }
  };

  const update = async (next: RunProgressSnapshot): Promise<void> => {
    current = { ...current, ...next };
    events.push({
      at: Date.now(),
      phase: current.phase,
      message: current.message,
      ...(typeof current.round === "number" ? { round: current.round } : {}),
      ...(typeof current.maxRounds === "number" ? { maxRounds: current.maxRounds } : {}),
    });
    if (events.length > 40) {
      events.splice(0, events.length - 40);
    }
    await persist();
  };

  return {
    update,
  };
}
