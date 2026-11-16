/** 模型尝试持久化解码；损坏记录拒绝恢复，模型错误再次按协议白名单脱敏。 */
import { z } from "zod";
import { read_model_error, type SessionModelRetry } from "@downcity/type";

const timestamp = z.number().int().nonnegative();
const identity = z.string().min(1);
const model_error = z.unknown().transform((value, context) => {
  const error = read_model_error(value);
  if (!error) { context.addIssue({ code: "custom", message: "Invalid saved model error" }); return z.NEVER; }
  return error;
});
const retry_schema = z.object({
  turn_id: identity,
  step_id: identity,
  model_id: identity,
  input_part_id: identity.optional(),
  active_attempt: z.object({ attempt_id: identity, started_at: timestamp }).optional(),
  status: z.enum(["failed", "running", "succeeded", "stopped", "superseded", "interrupted"]),
  recoverable: z.boolean(),
  reason: z.string().optional(),
  attempts: z.array(z.object({
    attempt_id: identity,
    started_at: timestamp,
    ended_at: timestamp,
    outcome: z.enum(["committed", "failed", "stopped", "interrupted"]),
    error: model_error.optional(),
    partial_text: z.string().optional(),
    partial_reasoning: z.string().optional(),
  })),
  receipts: z.array(z.object({
    request_id: identity,
    failure_attempt_id: identity,
    accepted_at: timestamp,
  })),
});

/** 仅返回通过完整字段校验的控制记录；异常交回存储错误边界。 */
export function decode_session_model_retry(value: unknown): SessionModelRetry {
  return retry_schema.parse(value);
}

/** 进程恢复只结算未确定的请求，不伪装旧连接仍然存活，也不重放工具。 */
export function interrupt_session_model_retry(record: SessionModelRetry, ended_at: number): SessionModelRetry {
  const active = record.active_attempt;
  return { ...record, status: "interrupted", recoverable: false, active_attempt: undefined,
    reason: "Process interrupted; original execution bindings are unavailable. Review completed work before starting a new request.",
    attempts: active ? [...record.attempts, { ...active, ended_at, outcome: "interrupted" }] : record.attempts };
}
