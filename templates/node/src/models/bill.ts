/**
 * Node 模板模型出账工具。
 *
 * 关键点（中文）
 * - 模型在注册时通过 bill() 生成账单行。
 * - CreditsService 负责真正扣款和记录 Transaction。
 */

import type { AIBillInput } from "@downcity/city";

const CHAT_REQUEST_COST_CREDITS = 10_000;

/**
 * 生成一次 AI 调用的账单行。
 */
export function bill_ai_request(input: AIBillInput, credits = CHAT_REQUEST_COST_CREDITS) {
  const mode = String(input.metering?.metadata?.mode ?? "request");
  return {
    credits,
    note: `AI ${mode}`,
    ref: read_bill_ref(input.output),
    metadata: {
      service_id: "ai",
      action_id: mode,
      model_id: input.metering?.model_id ?? input.model.id,
      channel_id: input.metering?.channel_id,
    },
  };
}

/**
 * 从输出对象中提取账单引用。
 */
function read_bill_ref(output: unknown): string | undefined {
  if (!output || typeof output !== "object" || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  const ref = record.job_id ?? record.id ?? record.ref;
  return typeof ref === "string" && ref.trim() ? ref.trim() : undefined;
}
