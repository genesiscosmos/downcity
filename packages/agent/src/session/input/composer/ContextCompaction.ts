/**
 * 单次 Session 摘要执行器。
 * 一次选择稳定历史并生成摘要，成功后一次提交 checkpoint；失败不改变原边界。
 * 已知模型窗口不足时只缩小本次选择范围，不分批重写累计摘要。
 */
import { ModelStreamFailure } from "@/model/ModelStreamFailure.js";
import { project_summary_part } from "@/model/messages/SessionModelMessages.js";
import { generate_model } from "@/model/ModelGenerate.js";
import type { SessionContextAdvanceInput } from "@/types/session/SessionComposer.js";
import type { ContextCompactionDiagnostic, ContextSummaryUnit } from "@/types/session/ContextCompaction.js";
import { render_summary_text } from "./ContextSummaryText.js";
import { collect_stable_units } from "./AdaptiveContextParts.js";
import { insert_checkpoint, read_latest_checkpoint } from "./AdaptiveContextCheckpoint.js";
import { build_session_summary_messages, CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS } from "./ContextSummaryPrompts.js";

import { estimate_context_tokens, select_compaction_target } from "./ContextTokenBudget.js";

/** 单次输入在实际模型窗口之外预留的协议余量。 */
const CONTEXT_SAFETY_TOKENS = 2_048;

/** 目标压缩约 65%，保留 10k 为软目标；预算恢复允许消费更短尾部。 */
export async function compact_context(input: SessionContextAdvanceInput, composer_name: string): Promise<boolean> {
  const model = input.model;
  if (!model) return false;
  input.abort_signal?.throwIfAborted();
  const window = input.context_window ?? model.context_window;
  const checkpoint = await read_latest_checkpoint(input.derived);
  const units: ContextSummaryUnit[] = [];
  for (const candidate of collect_stable_units(input.history, checkpoint)) {
    const records: string[] = [];
    for (const part of candidate.parts) {
      const projected = await project_summary_part(candidate.message, part);
      const text = render_summary_text(projected);
      if (text.trim()) records.push(text);
    }
    // 同一 Step 的多个 Tool 结果保持为一个单元，任何选取和预算裁剪都不能拆开。
    if (records.length) units.push({ ...candidate, text: records.join("\n\n") });
  }
  if (units.length === 0) return false;
  let target_count = select_compaction_target(units.map(unit => unit.text),
    input.trigger === "request_budget" || input.trigger === "provider_context_limit");
  if (target_count === 0) return false;
  if (!window || window <= 0) throw new Error("Model context window metadata is required for history compaction");
  const budget = window - CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS - Math.max(CONTEXT_SAFETY_TOKENS, Math.ceil(window * 0.05));
  const summary = checkpoint?.summary ?? "";
  const overhead = build_session_summary_messages(summary, []).reduce((sum, message) =>
    sum + message.content.reduce((total, part) => total + (part.type === "text" ? estimate_context_tokens(part.text) : 0), 0) + 16, 0);
  let used = overhead;
  let fitting_count = 0;
  for (const unit of units.slice(0, target_count)) {
    used += estimate_context_tokens(unit.text) + 16;
    if (used > budget) break;
    fitting_count++;
  }
  target_count = fitting_count;
  if (!target_count) throw complete_unit_budget_error(units[0]!);
  let messages = build_session_summary_messages(summary, units.slice(0, target_count).map(unit => unit.text));
  // 最终序列化预算含摘要 system、累计摘要、消息结构与输出余量；不依赖上面的单元近似。
  while (estimate_context_tokens(JSON.stringify({ messages, max_output_tokens: CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS })) + messages.length * 16 > budget) {
    if (--target_count === 0) throw complete_unit_budget_error(units[0]!);
    messages = build_session_summary_messages(summary, units.slice(0, target_count).map(unit => unit.text));
  }
  const boundary = units[target_count - 1]!;
  const texts = messages.flatMap(message => message.content.flatMap(part => part.type === "text" ? [part.text] : []));
  const input_characters = texts.reduce((sum, text) => sum + text.length, 0);
  const estimated_input_tokens = texts.reduce((sum, text) => sum + estimate_context_tokens(text), messages.length * 16);
  input.abort_signal?.throwIfAborted();
  await input.on_advance_start?.();
  // 仅传输中断允许原请求重试一次；部分摘要未提交，也可以安全丢弃重做。
  for (let attempt = 1; attempt <= 2; attempt++) {
    const diagnostic: ContextCompactionDiagnostic = {
      model_id: model.id,
      phase: "request",
      input_characters,
      estimated_input_tokens,
      input_message_count: messages.length,
      input_budget: budget ?? null,
      attempt,
      from_message_sequence: units[0]!.message.sequence,
      through_message_sequence: boundary.message.sequence,
      through_part_sequence: boundary.part.sequence,

    };
    await report(input, diagnostic);
    try {
      const result = await generate_model(model, {
        messages,
        max_output_tokens: CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS,
      }, { request_kind: "history_compaction", retry: false, signal: input.abort_signal, on_failure: input.on_model_request_failure });
      input.abort_signal?.throwIfAborted();
      if (result.finish_reason !== "stop") throw new Error(`Context summary was not completed (finish_reason=${result.finish_reason})`);
      const next_summary = result.text.trim();
      if (!next_summary) {
        throw new Error(`Context summary model returned an empty result (finish_reason=${String(result.finish_reason)}, usage=${JSON.stringify(result.usage ?? null)})`);
      }
      // 生成完整摘要后一次提交；任何请求失败都保持旧 checkpoint。
      await insert_checkpoint(input.derived, {
          through_message_id: boundary.message.message_id,
          through_message_sequence: boundary.message.sequence,
          through_part_sequence: boundary.part.sequence,
          summary: next_summary,
      });
      await report(input, { ...diagnostic, phase: "completed" });
      return true;
    } catch (error) {
      await report(input, {
        ...diagnostic, phase: "failed", error: String(error),
        ...(error instanceof ModelStreamFailure ? { error_code: error.code, provider_request_id: error.provider_request_id } : {}),
      });
      if (attempt === 2 || !(error instanceof ModelStreamFailure) || error.code !== "transport_error"
        || !error.retryable || /\b(?:400|401|403|404|422)\b/.test(error.message)) throw error;
    }
  }
  throw new Error("Context summary request attempts exhausted");
}

/** 预算不足时报告完整单元位置，不降级为截断 Tool 结果或半个 Step。 */
function complete_unit_budget_error(unit: ContextSummaryUnit): Error {
  return new Error(`Summary request cannot fit one complete Step/input history unit with the existing summary and output reserve (message_sequence=${unit.message.sequence}, from_part_sequence=${unit.parts[0]!.sequence}, through_part_sequence=${unit.part.sequence})`);
}

/** 诊断不参与领域提交，观测失败不能改变压缩结果。 */
async function report(input: SessionContextAdvanceInput, diagnostic: ContextCompactionDiagnostic): Promise<void> {
  try { await input.on_compaction_diagnostic?.(diagnostic); } catch { /* 观测不影响摘要。 */ }
}
