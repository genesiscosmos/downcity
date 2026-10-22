/**
 * 任务工作状态的校验与时间语义。
 *
 * 所有输入在写入前归一化；日期型截止与触发时刻分开，周期身份使用任务时区的
 * 本地分钟，避免夏令时回拨导致同一计划重复发生。
 *
 * 这里同时是 `[workflow]` 表、`[[occurrences]]` 与 `[[inbox]]` 的唯一校验入口：
 * 状态还嵌在 `task.toml` 里，任何绕过它的读取都会让「损坏状态」变成静默丢数据。
 */

import { z } from "zod";
import type { ShipTaskDefinitionV1 } from "../types/Task.js";
import type {
  TaskInboxItem,
  TaskOccurrence,
  TaskProgress,
  TaskState,
} from "../types/TaskWorkflow.js";

/** 全部工作进度取值，顺序即界面上的推进顺序。 */
export const TASK_PROGRESS_VALUES: TaskProgress[] = [
  "pending",
  "in_progress",
  "review",
  "completed",
  "cancelled",
];

const progress_schema = z.enum([
  "pending",
  "in_progress",
  "review",
  "completed",
  "cancelled",
]);

const occurrence_schema = z.object({
  occurrence_id: z.string().min(1),
  planned_at: z.iso.datetime(),
  status: z.union([progress_schema, z.literal("skipped")]),
  execution_id: z.string().optional(),
  run_timestamp: z.string().optional(),
  completed_at: z.iso.datetime().optional(),
});

const inbox_schema = z.object({
  item_id: z.string().min(1),
  kind: z.enum(["reminder", "review", "failure", "missed"]),
  message: z.string(),
  created_at: z.iso.datetime(),
  resolved: z.boolean(),
  occurrence_id: z.string().optional(),
  run_timestamp: z.string().optional(),
  feedback: z.string().trim().min(1).max(24000).optional(),
});

/** 校验精确时间，拒绝没有时区的字符串。 */
export function normalize_task_instant(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!z.iso.datetime({ offset: true }).safeParse(value).success) {
    throw new Error("时间必须包含时区");
  }
  const instant = Date.parse(String(value));
  if (!Number.isFinite(instant)) throw new Error("无效的日期时间");
  return new Date(instant).toISOString();
}

/** 校验截止日期或精确时刻，不把日期自动转成午夜触发。 */
export function normalize_task_due(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      throw new Error("无效的截止日期");
    return value;
  }
  return normalize_task_instant(value);
}

/** 解析并校验一条周期发生记录。 */
export function normalize_task_occurrences(value: unknown): TaskOccurrence[] {
  return z.array(occurrence_schema).parse(value ?? []);
}

/** 解析并校验一条收件箱事项。 */
export function normalize_task_inbox(value: unknown): TaskInboxItem[] {
  return z.array(inbox_schema).parse(value ?? []);
}

/**
 * 统一解析定义中的工作状态。
 *
 * 缺省值给出「刚创建、未整理完」的形态；非法值抛错而不是兜底，损坏的定义必须
 * 作为可观察的 issue 暴露出来。
 */
export function normalize_task_state(input: unknown): TaskState {
  const value =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const progress = value.progress ?? "pending";
  if (!TASK_PROGRESS_VALUES.includes(progress as TaskProgress))
    throw new Error("无效的工作进度");
  const timezone = String(
    value.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error(`无效的时区: ${timezone}`);
  }
  if (value.organized !== undefined && typeof value.organized !== "boolean")
    throw new Error("organized 必须是布尔值");
  if (
    value.require_acceptance !== undefined &&
    typeof value.require_acceptance !== "boolean"
  )
    throw new Error("require_acceptance 必须是布尔值");
  const planned_at = normalize_task_instant(value.planned_at);
  const due_at = normalize_task_due(value.due_at);
  const planned_end_at = normalize_task_instant(value.planned_end_at);
  if (planned_end_at && (!planned_at || Date.parse(planned_end_at) <= Date.parse(planned_at)))
    throw new Error("计划结束时间必须晚于计划开始时间");
  const completed_at = normalize_task_instant(value.completed_at);
  const created_at =
    normalize_task_instant(value.created_at) || new Date().toISOString();
  const updated_at = normalize_task_instant(value.updated_at) || created_at;
  return {
    created_at,
    updated_at,
    progress: progress as TaskProgress,
    organized: value.organized !== false,
    timezone,
    require_acceptance: value.require_acceptance === true,
    ...(planned_at ? { planned_at } : {}),
    ...(planned_end_at ? { planned_end_at } : {}),
    ...(due_at ? { due_at } : {}),
    ...(completed_at ? { completed_at } : {}),
    ...(value.active_execution_id
      ? { active_execution_id: String(value.active_execution_id) }
      : {}),
    occurrences: normalize_task_occurrences(value.occurrences),
    inbox: normalize_task_inbox(value.inbox),
  };
}

/** 工作进入终态后，不允许继续自动触发。 */
export function task_work_is_closed(task: ShipTaskDefinitionV1): boolean {
  const progress = task.workflow?.progress;
  return progress === "completed" || progress === "cancelled";
}

/** 判断是否为重复规则，不受一次性执行后 when 回退影响。 */
export function task_is_recurring(task: ShipTaskDefinitionV1): boolean {
  return task.when !== "@manual" && !task.when.startsWith("time:");
}

/** 使用明确任务时区产生分钟级发生身份；回拨的同一当地时间只产生一次。 */
export function task_occurrence_key(
  task: ShipTaskDefinitionV1,
  at: Date,
): string {
  if (!task_is_recurring(task)) return `once:${task.when}`;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: normalize_task_state(task.workflow).timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}
