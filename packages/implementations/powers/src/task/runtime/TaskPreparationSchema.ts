/** 生成状态与模型结果的统一校验；生成成功后直接生效。 */
import { z } from "zod";
export const task_preparation_schema = z.object({
  revision: z.number().int().positive(),
  status: z.enum(["queued", "analyzing", "delegating", "needs_input", "proposed", "ready", "failed"]),
  processing_id: z.string().optional(),
  supplements: z.array(z.string()),
  questions: z.array(z.string()),
  error: z.string().optional(),
  analyzed_body: z.string().max(60000).optional(),
  schedule_error: z.string().optional(),
  start_error: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
  start_now: z.boolean().optional(),
}).transform((preparation) => {
  // 已落盘的待确认方案保留身份与正文，转为可重试状态，避免旧状态使整条任务无法读取。
  if (preparation.status === "proposed") return { ...preparation, status: "failed" as const, error: "任务流程已更新，请重新生成安排" };
  return { ...preparation, status: preparation.status };
});
export const task_analysis_schema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(60000),
  kind: z.enum(["user", "agent"]),
  agent_id: z.string(),
  workspace_id: z.string(),
  when: z.string(),
  start_now: z.boolean().optional(),
  planned_at: z.string().optional(),
  planned_end_at: z.string().optional(),
  due_at: z.string().optional(),
  questions: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
});
