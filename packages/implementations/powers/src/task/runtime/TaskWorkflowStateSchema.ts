/**
 * 任务聚合状态的纯校验模块。
 *
 * 定义解析依赖纯 schema，不依赖存储或执行协调器，避免 Store → Model → Store 的
 * 循环依赖。损坏状态必须作为定义错误暴露，不静默丢弃历史。
 */
import { z } from "zod";
import type { TaskWorkflowState } from "../types/TaskWorkflow.js";

const work_status_schema = z.enum([
  "pending",
  "in_progress",
  "review",
  "completed",
  "cancelled",
]);
const state_schema = z.object({
  occurrences: z.array(
    z.object({
      occurrence_id: z.string().min(1),
      planned_at: z.iso.datetime(),
      status: z.union([work_status_schema, z.literal("skipped")]),
      execution_id: z.string().optional(),
      run_timestamp: z.string().optional(),
      completed_at: z.iso.datetime().optional(),
    }),
  ),
  inbox: z.array(
    z.object({
      item_id: z.string().min(1),
      kind: z.enum(["reminder", "review", "failure", "missed"]),
      message: z.string(),
      created_at: z.iso.datetime(),
      resolved: z.boolean(),
      occurrence_id: z.string().optional(),
      run_timestamp: z.string().optional(),
    }),
  ),
});

/** 读取并校验任务状态；缺省状态为空，非法状态明确抛错。 */
export function normalize_task_workflow_state(
  value: unknown,
): TaskWorkflowState {
  return state_schema.parse(value ?? { occurrences: [], inbox: [] });
}
