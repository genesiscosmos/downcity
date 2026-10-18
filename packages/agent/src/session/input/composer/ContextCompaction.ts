/**
 * 有输入预算的累计摘要执行器。
 * 复用模型语义投影，固定本次目标后串行分批；每个完整单元成功才推进 checkpoint。
 * 超大单元在内存中分片累计，全部完成前不提交边界，失败可从上次持久化边界重做。
 */
import { ModelStreamFailure } from "@/model/ModelStreamFailure.js";
import { project_summary_part } from "@/model/messages/SessionModelMessages.js";
import { build_text_model_messages, generate_model } from "@/model/ModelGenerate.js";
import type { SessionContextAdvanceInput } from "@/types/session/SessionComposer.js";
import type { ContextCompactionDiagnostic, ContextSummaryUnit } from "@/types/session/ContextCompaction.js";
import { collect_stable_parts } from "./AdaptiveContextParts.js";
import { insert_checkpoint, read_latest_checkpoint } from "./AdaptiveContextCheckpoint.js";
import { build_initial_session_summary_prompt, build_updated_session_summary_prompt, CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS, CONTEXT_SUMMARY_SYSTEM_PROMPT } from "./ContextSummaryPrompts.js";

import { context_fragment_end, estimate_context_tokens, select_compaction_target } from "./ContextTokenBudget.js";

/** 摘要输入预算上限；包含旧摘要、本批历史和提示词。 */
const DEFAULT_INPUT_BUDGET = 64_000;
const MIN_INPUT_BUDGET = 1_024;
const MAX_SHRINK_ATTEMPTS = 3;

/** 目标压缩约 65%，至少保留 10k 原始历史，固定边界后按预算分批推进。 */
export async function compact_context(input: SessionContextAdvanceInput, composer_name: string): Promise<boolean> {
  const model = input.model;
  if (!model) return false;
  const checkpoint = await read_latest_checkpoint(input.derived, composer_name);
  const units: ContextSummaryUnit[] = [];
  for (const candidate of collect_stable_parts(input.history, checkpoint)) {
    const projected = await project_summary_part(candidate.message, candidate.part);
    const text = projected.map(message => `${message.role}: ${JSON.stringify(message.content)}`).join("\n");
    if (text.trim()) units.push({ ...candidate, text });
  }
  if (units.length === 0) return false;
  const target_count = select_compaction_target(units.map(unit => unit.text));
  if (target_count === 0) return false;
  await input.on_advance_start?.();
  const window = model.context_window;
  let budget = Math.min(DEFAULT_INPUT_BUDGET, window && window > 0
    ? window - CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS - 2_048 : DEFAULT_INPUT_BUDGET);
  if (budget < MIN_INPUT_BUDGET) throw new Error("Model context window is too small for context summarization");
  let summary = checkpoint?.summary ?? "";
  let index = 0;
  let offset = 0;
  let shrink_attempts = 0;
  while (index < target_count) {
    const prompt_overhead = estimate_context_tokens(build_prompt(summary, "")) + estimate_context_tokens(CONTEXT_SUMMARY_SYSTEM_PROMPT);
    const available = budget - prompt_overhead - 256;
    if (available < 256) throw new Error("Context summary leaves insufficient input budget for history");
    const first = units[index]!;
    let end_index = index;
    let text = "";
    let next_offset = 0;
    if (offset > 0 || estimate_context_tokens(first.text) + 1 > available) {
      next_offset = context_fragment_end(first.text, offset, available);
      text = `History fragment (${offset === 0 ? "start" : "continued"}):\n${first.text.slice(offset, next_offset)}`;
      if (next_offset === first.text.length) { end_index++; next_offset = 0; }
    } else {
      let batch_tokens = 0;
      while (end_index < target_count) {
        const next_text = units[end_index]!.text;
        const next_tokens = estimate_context_tokens(next_text) + 1;
        if (batch_tokens + next_tokens > available) break;
        text += `${text ? "\n" : ""}${next_text}`;
        batch_tokens += next_tokens;
        end_index++;
      }
    }
    const boundary = units[Math.max(index, end_index - 1)]!;
    const prompt = build_prompt(summary, text);
    const diagnostic: ContextCompactionDiagnostic = {
      model_id: model.id,
      phase: "request",
      input_characters: prompt.length + CONTEXT_SUMMARY_SYSTEM_PROMPT.length,
      estimated_input_tokens: estimate_context_tokens(prompt) + estimate_context_tokens(CONTEXT_SUMMARY_SYSTEM_PROMPT),
      input_budget: budget,
      from_message_sequence: first.message.sequence,
      through_message_sequence: boundary.message.sequence,
      through_part_sequence: boundary.part.sequence,
      partial_unit: offset > 0 || next_offset > 0,
    };
    await report(input, diagnostic);
    try {
      const result = await generate_model(model, {
        messages: build_text_model_messages(CONTEXT_SUMMARY_SYSTEM_PROMPT, prompt),
        max_output_tokens: CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS,
      }, { request_kind: "history_compaction", retry: false, on_failure: input.on_model_request_failure });
      const next_summary = result.text.trim();
      if (!next_summary) throw new Error("Context summary model returned an empty result");
      // 片段摘要只在内存累积；完整单元结束后才允许裁掉对应原始历史。
      if (next_offset === 0) {
        await insert_checkpoint(input.derived, composer_name, {
          through_message_id: boundary.message.message_id,
          through_message_sequence: boundary.message.sequence,
          through_part_sequence: boundary.part.sequence,
          summary: next_summary,
        });
      }
      summary = next_summary;
      index = end_index;
      offset = next_offset;
      shrink_attempts = 0;
      await report(input, { ...diagnostic, phase: "completed" });
    } catch (error) {
      await report(input, {
        ...diagnostic, phase: "failed", error: String(error),
        ...(error instanceof ModelStreamFailure ? { error_code: error.code, provider_request_id: error.provider_request_id } : {}),
      });
      // 仅明确的上下文超限允许缩批；普通 HTTP 400 等错误保留原始诊断并停止。
      if (!is_input_limit(error) || shrink_attempts >= MAX_SHRINK_ATTEMPTS || budget <= MIN_INPUT_BUDGET) throw error;
      budget = Math.max(MIN_INPUT_BUDGET, Math.floor(budget / 2));
      shrink_attempts++;
    }
  }
  return true;
}

/** 新摘要始终合并当前累计状态与本批内容。 */
function build_prompt(summary: string, conversation_text: string): string {
  return summary.trim()
    ? build_updated_session_summary_prompt({ previous_summary: summary, conversation_text })
    : build_initial_session_summary_prompt({ conversation_text });
}

/** 明确识别上下文输入超限；不将泛化 400 解释为 token 超限。 */
function is_input_limit(error: unknown): boolean {
  return /context_length|maximum context|context window|too many tokens|input.{0,30}too long/i.test(String(error));
}

/** 诊断不参与领域提交，观测失败不能改变压缩结果。 */
async function report(input: SessionContextAdvanceInput, diagnostic: ContextCompactionDiagnostic): Promise<void> {
  try { await input.on_compaction_diagnostic?.(diagnostic); } catch { /* 观测不影响摘要。 */ }
}
