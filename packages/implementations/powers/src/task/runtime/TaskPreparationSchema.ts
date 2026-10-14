/** 准备事实与分析结果的统一输入校验。 */
import { z } from "zod";
export const task_preparation_schema = z.object({
  revision: z.number().int().positive(),
  status: z.enum(["queued", "analyzing", "delegating", "needs_input", "ready", "failed"]),
  processing_id: z.string().optional(),
  supplements: z.array(z.string()),
  questions: z.array(z.string()),
  error: z.string().optional(),
  analyzed_body: z.string().max(60000).optional(),
  schedule_error: z.string().optional(),
  authorization_quote: z.string().max(1000).optional(),
});
export const task_analysis_schema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(60000),
  kind: z.enum(["self", "agent"]),
  agent_id: z.string(),
  workspace_id: z.string(),
  when: z.string(),
  start_now: z.boolean().optional(),
  planned_at: z.string().optional(),
  due_at: z.string().optional(),
  questions: z.array(z.string().min(1)).max(10),
  authorization_quote: z.string().max(1000).optional(),
});
