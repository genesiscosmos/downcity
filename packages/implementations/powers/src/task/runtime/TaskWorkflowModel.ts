/**
 * 统一任务工作属性校验与时间语义。
 *
 * 所有输入在持久化前归一化；日期型截止与触发时刻分开，周期身份使用任务时区的
 * 本地分钟，避免夏令时回拨导致同一计划重复发生。
 */
import { z } from "zod";
import type { ShipTaskDefinitionV1 } from "../types/Task.js";
import type { TaskWorkflow, TaskWorkStatus } from "../types/TaskWorkflow.js";

export const TASK_WORK_STATUSES: TaskWorkStatus[] = [
  "pending",
  "in_progress",
  "review",
  "completed",
  "cancelled",
];

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

/** 统一解析定义中的工作管理属性。 */
export function normalize_task_workflow(input: unknown): TaskWorkflow {
  const value =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const work_status = value.work_status ?? "pending";
  if (!TASK_WORK_STATUSES.includes(work_status as TaskWorkStatus))
    throw new Error("无效的工作状态");
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
  const completed_at = normalize_task_instant(value.completed_at);
  const created_at =
    normalize_task_instant(value.created_at) || new Date().toISOString();
  const updated_at = normalize_task_instant(value.updated_at) || created_at;
  return {
    created_at,
    updated_at,
    work_status: work_status as TaskWorkStatus,
    organized: value.organized !== false,
    timezone,
    require_acceptance: value.require_acceptance === true,
    ...(planned_at ? { planned_at } : {}),
    ...(due_at ? { due_at } : {}),
    ...(completed_at ? { completed_at } : {}),
    ...(value.active_execution_id
      ? { active_execution_id: String(value.active_execution_id) }
      : {}),
  };
}

/** 工作进入终态后，不允许继续自动触发。 */
export function task_work_is_closed(task: ShipTaskDefinitionV1): boolean {
  const status = task.frontmatter.workflow?.work_status;
  return status === "completed" || status === "cancelled";
}

/** 判断是否为重复规则，不受一次性执行后 when 回退影响。 */
export function task_is_recurring(task: ShipTaskDefinitionV1): boolean {
  return (
    task.frontmatter.when !== "@manual" &&
    !task.frontmatter.when.startsWith("time:")
  );
}

/** 使用明确任务时区产生分钟级发生身份；回拨的同一当地时间只产生一次。 */
export function task_occurrence_key(
  task: ShipTaskDefinitionV1,
  at: Date,
): string {
  if (!task_is_recurring(task))
    return `once:${task.frontmatter.workflow?.planned_at || task.frontmatter.when}`;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: normalize_task_workflow(task.frontmatter.workflow).timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(task.frontmatter.when.trim().split(/\s+/).length === 6
      ? { second: "2-digit" as const }
      : {}),
  }).format(at);
}
