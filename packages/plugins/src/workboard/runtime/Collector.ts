/**
 * Workboard 快照采集器。
 *
 * 关键点（中文）
 * - 这里只做确定性采集，不引入 LLM 推理。
 * - 内部仍聚合 session、task、plugin runtime 三类运行事实，但最终只输出对外安全的模糊状态。
 */

import { listTaskDefinitions } from "@/task/Action.js";
import { list_plugin_states } from "@downcity/agent";
import type { PluginContext } from "@downcity/agent";
import type { WorkboardSnapshot } from "@/workboard/types/Workboard.js";
import { listWorkboardSessionSummaries } from "@/workboard/runtime/SessionSummary.js";
import {
  buildIdleActivity,
  toRecentActivity,
  toRunningActivity,
  toWorkboardAgentSummary,
  toWorkboardSignals,
  toWorkboardSummary,
} from "@/workboard/runtime/Normalizer.js";

const WORKBOARD_RECENT_LIMIT = 8;

/**
 * 采集当前 workboard 快照。
 */
export async function collectWorkboardSnapshot(
  context: PluginContext,
): Promise<WorkboardSnapshot> {
  const collectedAt = new Date().toISOString();
  const executingSessionIds = new Set(context.sessions.list_executing_session_ids());
  const sessions = await listWorkboardSessionSummaries({
    context,
    limit: WORKBOARD_RECENT_LIMIT + Math.max(executingSessionIds.size, 1),
    executingSessionIds,
  });
  const runtimePlugins = list_plugin_states({ context });
  const taskResult = await listTaskDefinitions({ project_root: context.workspace_path });
  const degradedCount = runtimePlugins.filter(
    (item) => item.status !== "ready",
  ).length;

  const current = sessions
    .filter((item) => item.executing === true)
    .slice(0, 4)
    .map((item, index) => toRunningActivity({ item, index }));
  const recent = sessions
    .filter((item) => item.executing !== true)
    .slice(0, WORKBOARD_RECENT_LIMIT)
    .map((item, index) => toRecentActivity({ item, index }));

  const safeCurrent = current.length > 0
    ? current
    : [buildIdleActivity({ updated_at: collectedAt, recentCount: recent.length })];

  return {
    agent: toWorkboardAgentSummary({
      context,
      collectedAt,
      currentCount: current.length,
      recentCount: recent.length,
      degradedCount,
    }),
    summary: toWorkboardSummary({
      currentCount: current.length,
      recentCount: recent.length,
      degradedCount,
    }),
    current: safeCurrent,
    recent,
    signals: toWorkboardSignals({
      currentCount: current.length,
      recentCount: recent.length,
      plugins: runtimePlugins,
      taskResult,
    }),
  };
}
