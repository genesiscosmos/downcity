/**
 * Workboard 结构化归一化工具。
 *
 * 关键点（中文）
 * - 这里负责把内部运行事实投影成“对外模糊公开态”。
 * - 所有会泄漏上下文的字段都必须在这里截断或抽象。
 */

import type { PluginSnapshot } from "@downcity/agent";
import type { TaskListResponse } from "@/task/types/TaskCommand.js";
import type { WorkboardSessionSummary } from "@/workboard/runtime/SessionSummary.js";
import type {
  WorkboardActivityItem,
  WorkboardAgentSummary,
  WorkboardSignalItem,
  WorkboardSummary,
} from "@/workboard/types/Workboard.js";
import type { PluginContext } from "@downcity/agent";

function toIsoString(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return new Date().toISOString();
  }
  return new Date(timestamp).toISOString();
}

function buildHeadline(params: {
  currentCount: number;
  recentCount: number;
  degradedCount: number;
}): string {
  if (params.currentCount > 0 && params.degradedCount > 0) {
    return "当前仍在展开，但节奏出现了一些波动";
  }
  if (params.currentCount > 1) {
    return "当前呈现多线展开的状态";
  }
  if (params.currentCount === 1) {
    return "当前呈现稳定展开的状态";
  }
  if (params.recentCount > 0) {
    return "刚刚有过新的进展，现在进入短暂停留";
  }
  return "当前处于安静待命的状态";
}

function buildPosture(params: { currentCount: number; recentCount: number }): string {
  if (params.currentCount > 1) return "多线展开";
  if (params.currentCount === 1) return "单线聚焦";
  if (params.recentCount > 0) return "短暂停留";
  return "静候下一步";
}

function buildMomentum(params: { currentCount: number; recentCount: number }): string {
  if (params.currentCount > 1) return "活跃展开";
  if (params.currentCount === 1) return "平稳延续";
  if (params.recentCount > 2) return "轻微起伏";
  if (params.recentCount > 0) return "余温未散";
  return "安静";
}

function buildRunningSummary(item: WorkboardSessionSummary): string {
  const message_count = typeof item.message_count === "number" ? item.message_count : 0;
  if (message_count >= 24) return "正在延展一段较长的工作脉络，并持续生成新的内容。";
  if (message_count >= 8) return "正在承接连续输入，逐步形成新的阶段结果。";
  if (message_count > 0) return "正在回应当前输入，并把工作继续向前展开。";
  return "当前处于活跃展开之中。";
}

function buildRecentSummary(item: WorkboardSessionSummary, index: number): string {
  const message_count = typeof item.message_count === "number" ? item.message_count : 0;
  if (index === 0 && message_count > 0) return "刚刚完成一段新的展开，正在短暂停留。";
  if (message_count >= 12) return "近期完成了一次较长的内容延展。";
  if (message_count > 0) return "近期完成了一次常规更新。";
  return "近期出现了一次轻微变化。";
}

/**
 * 构建 agent 顶部公开摘要。
 */
export function toWorkboardAgentSummary(params: {
  context: PluginContext;
  collectedAt: string;
  currentCount: number;
  recentCount: number;
  degradedCount: number;
}): WorkboardAgentSummary {
  const statusText = buildHeadline({
    currentCount: params.currentCount,
    recentCount: params.recentCount,
    degradedCount: params.degradedCount,
  });

  return {
    name: String(params.context.agent_id || "").trim() || "agent",
    running: true,
    statusText,
    collectedAt: params.collectedAt,
  };
}

/**
 * 将运行中的 session 映射为对外安全活动项。
 */
export function toRunningActivity(params: {
  item: WorkboardSessionSummary;
  index: number;
}): WorkboardActivityItem {
  const title = params.index === 0 ? "当前主线" : `当前并行线 ${params.index + 1}`;

  return {
    id: `current:${params.index + 1}`,
    kind: "focus",
    title,
    summary: buildRunningSummary(params.item),
    status: "active",
    updated_at: toIsoString(params.item.updated_at),
    tags: ["public", "active"],
  };
}

/**
 * 将近期 session 映射为对外安全活动项。
 */
export function toRecentActivity(params: {
  item: WorkboardSessionSummary;
  index: number;
}): WorkboardActivityItem {
  const title = params.index === 0 ? "最近一次更新" : `近期片段 ${params.index + 1}`;

  return {
    id: `recent:${params.index + 1}`,
    kind: "progress",
    title,
    summary: buildRecentSummary(params.item, params.index),
    status: params.index === 0 ? "steady" : "waiting",
    updated_at: toIsoString(params.item.updated_at),
    tags: ["public", "recent"],
  };
}

/**
 * 构建空闲占位项。
 */
export function buildIdleActivity(params: {
  updated_at: string;
  recentCount: number;
}): WorkboardActivityItem {
  return {
    id: "idle:standby",
    kind: "idle",
    title: "Quietly standing by",
    summary: params.recentCount > 0
      ? "刚刚有过新的更新，现在等待下一次输入。"
      : "当前没有明显变化，等待新的触发。",
    status: "waiting",
    updated_at: params.updated_at,
    tags: ["public", "idle"],
  };
}

/**
 * 构建公开摘要。
 */
export function toWorkboardSummary(params: {
  currentCount: number;
  recentCount: number;
  degradedCount: number;
}): WorkboardSummary {
  return {
    headline: buildHeadline(params),
    posture: buildPosture(params),
    momentum: buildMomentum(params),
    visibilityNote: "这里展示的是面向外部的概览状态，不包含内部上下文细节。",
  };
}

/**
 * 构建对外模糊信号。
 */
export function toWorkboardSignals(params: {
  currentCount: number;
  recentCount: number;
  plugins: PluginSnapshot[];
  taskResult: TaskListResponse;
}): WorkboardSignalItem[] {
  const degradedCount = params.plugins.filter(
    (item) => item.status !== "ready",
  ).length;
  const taskCount = Array.isArray(params.taskResult.tasks) ? params.taskResult.tasks.length : 0;

  return [
    {
      label: "状态节奏",
      value: params.currentCount > 1
        ? "多线展开"
        : params.currentCount === 1
          ? "稳定展开"
          : params.recentCount > 0
            ? "轻微流动"
            : "安静待命",
      tone: params.currentCount > 0 ? "accent" : "neutral",
    },
    {
      label: "现场感受",
      value: degradedCount > 0 ? "有些波动" : "整体平稳",
      tone: degradedCount > 0 ? "warning" : "neutral",
    },
    {
      label: "活跃温度",
      value: taskCount > 0 || params.recentCount > 0 ? "仍有余温" : "较为安静",
      tone: params.recentCount > 0 ? "accent" : "neutral",
    },
  ];
}
