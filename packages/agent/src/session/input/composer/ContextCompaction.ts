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
import { collect_stable_parts } from "./AdaptiveContextParts.js";
import { insert_checkpoint, read_latest_checkpoint } from "./AdaptiveContextCheckpoint.js";
import { build_session_summary_messages, CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS } from "./ContextSummaryPrompts.js";

import { estimate_context_tokens, select_compaction_target } from "./ContextTokenBudget.js";

/** 单次输入在实际模型窗口之外预留的协议余量。 */
const CONTEXT_SAFETY_TOKENS = 2_048;

/** 目标压缩约 65%，至少保留 10k 原始历史，一次生成并提交摘要。 */
export async function compact_context(input: SessionContextAdvanceInput, composer_name: string): Promise<boolean> {
  const model = input.model;
  if (!model) return false;
  const checkpoint = await read_latest_checkpoint(input.derived, composer_name);
  const units: ContextSummaryUnit[] = [];
  for (const candidate of collect_stable_parts(input.history, checkpoint)) {
    const projected = await project_summary_part(candidate.message, candidate.part);
    const text = render_summary_text(projected);
    if (text.trim()) units.push({ ...candidate, text });
  }
  if (units.length === 0) return false;
  let target_count = select_compaction_target(units.map(unit => unit.text));
  if (target_count === 0) return false;
  const window = model.context_window;
  const budget = window && window > 0
    ? window - CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS - CONTEXT_SAFETY_TOKENS : undefined;
  const summary = checkpoint?.summary ?? "";
  const overhead = build_session_summary_messages(summary, []).reduce((sum, message) =>
    sum + message.content.reduce((total, part) => total + (part.type === "text" ? estimate_context_tokens(part.text) : 0), 0) + 16, 0);
  if (budget !== undefined) {
    let used = overhead;
    let fitting_count = 0;
    for (const unit of units.slice(0, target_count)) {
      used += estimate_context_tokens(unit.text) + 16;
      if (used > budget) break;
      fitting_count++;
    }
    target_count = fitting_count;
    if (!target_count) throw new Error("Model context window cannot fit a complete history unit with the existing summary");
  }
  const boundary = units[target_count - 1]!;
  const records = units.slice(0, target_count).map(unit => unit.text);
  const messages = build_session_summary_messages(summary, records);
  const texts = messages.flatMap(message => message.content.flatMap(part => part.type === "text" ? [part.text] : []));
  const input_characters = texts.reduce((sum, text) => sum + text.length, 0);
  const estimated_input_tokens = texts.reduce((sum, text) => sum + estimate_context_tokens(text), messages.length * 16);
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
      }, { request_kind: "history_compaction", retry: false, on_failure: input.on_model_request_failure });
      const next_summary = result.text.trim();
      if (!next_summary) {
        throw new Error(`Context summary model returned an empty result (finish_reason=${String(result.finish_reason)}, usage=${JSON.stringify(result.usage ?? null)})`);
      }
      // 生成完整摘要后一次提交；任何请求失败都保持旧 checkpoint。
      await insert_checkpoint(input.derived, composer_name, {
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

/** 诊断不参与领域提交，观测失败不能改变压缩结果。 */
async function report(input: SessionContextAdvanceInput, diagnostic: ContextCompactionDiagnostic): Promise<void> {
  try { await input.on_compaction_diagnostic?.(diagnostic); } catch { /* 观测不影响摘要。 */ }
}
