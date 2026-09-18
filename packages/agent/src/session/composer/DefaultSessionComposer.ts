/**
 * 默认 Session Composer。
 *
 * 负责组装当前 Step 的 system、messages 与 tools，并在上下文压力出现时把较旧的稳定
 * Part 折叠进累计摘要 checkpoint。
 *
 * 关键点（中文）
 * - canonical history 由调用方传入，本模块只读取它，从不改写。
 * - 压缩结果只写自己的 checkpoint 派生表；下一次 compose 才会读到新边界。
 * - 自定义压缩算法可以继承本类并只覆盖 `advance_context()`。
 */

import { build_text_model_messages, generate_model } from "@/model/ModelGenerate.js";
import { session_messages_to_model_messages } from "@/model/messages/SessionModelMessages.js";
import type {
  SessionComposer,
  SessionComposeInput,
  SessionContextAdvanceInput,
  SessionContextDiagnostics,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import type { ContextCheckpointRow } from "@/types/session/ContextCheckpoint.js";
import {
  build_composer_system_blocks,
  inject_power_context,
  to_system_messages,
} from "@/session/composer/ComposerAssembly.js";
import {
  initialize_checkpoint_schema,
  insert_checkpoint,
  read_latest_checkpoint,
} from "@/session/composer/AdaptiveContextCheckpoint.js";
import {
  candidate_to_summary_text,
  collect_stable_parts,
  compare_position,
  select_compact_parts,
  slice_messages_after_checkpoint,
} from "@/session/composer/AdaptiveContextParts.js";
import {
  build_initial_session_summary_prompt,
  build_updated_session_summary_prompt,
  CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS,
  CONTEXT_SUMMARY_SYSTEM_PROMPT,
} from "@/session/composer/ContextSummaryPrompts.js";

/** 基于 Part 级 checkpoint 的默认 Composer。 */
export class DefaultSessionComposer implements SessionComposer {
  /** Composer 名称，同时作为派生表命名空间。 */
  readonly name = "adaptive_part";

  /** 创建累计摘要 checkpoint 派生表。 */
  async initialize(
    input: Parameters<SessionComposer["initialize"]>[0],
  ): Promise<void> {
    await initialize_checkpoint_schema(input.derived, this.name);
  }

  /** 返回显式摘要 system block 与 checkpoint 边界后的 canonical 历史。 */
  async compose(input: SessionComposeInput): Promise<SessionStepInput> {
    const checkpoint = await read_latest_checkpoint(input.derived, this.name);
    const system_blocks = await build_composer_system_blocks(input);
    if (checkpoint?.summary.trim()) {
      system_blocks.push({
        source: "session",
        name: "context-summary",
        content: `<session-context-summary>\n${checkpoint.summary}\n</session-context-summary>`,
      });
    }
    const tail = checkpoint
      ? slice_messages_after_checkpoint(input.history, checkpoint)
      : input.history;
    return {
      system: to_system_messages(system_blocks),
      system_blocks,
      messages: inject_power_context(
        await session_messages_to_model_messages(tail, input.session.project_root),
        input.state.power_context_blocks ?? [],
      ),
      tools: { ...input.state.tools },
      context_diagnostics: build_diagnostics(this.name, input.history, checkpoint),
    };
  }

  /** 按体积选择较旧稳定 Part，合并进累计摘要并推进 checkpoint。 */
  async advance_context(input: SessionContextAdvanceInput): Promise<boolean> {
    if (!input.model) return false;
    const previous = await read_latest_checkpoint(input.derived, this.name);
    const compact_parts = select_compact_parts(
      collect_stable_parts(input.history, previous),
    );
    const boundary = compact_parts.at(-1);
    if (!boundary) return false;
    const conversation_text = compact_parts
      .map(candidate_to_summary_text)
      .filter(Boolean)
      .join("\n");
    if (!conversation_text) return false;

    const prompt = previous?.summary.trim()
      ? build_updated_session_summary_prompt({
          previous_summary: previous.summary,
          conversation_text,
        })
      : build_initial_session_summary_prompt({ conversation_text });
    const result = await generate_model(input.model, {
      messages: build_text_model_messages(CONTEXT_SUMMARY_SYSTEM_PROMPT, prompt),
      max_output_tokens: CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS,
    }, {
      request_kind: "history_compaction",
      on_failure: input.on_model_request_failure,
    });
    const summary = String(result.text || "").trim();
    if (!summary) throw new Error("Context summary model returned an empty result");

    try {
      await insert_checkpoint(input.derived, this.name, {
        through_message_id: boundary.message.message_id,
        through_message_sequence: boundary.message.sequence,
        through_part_sequence: boundary.part.sequence,
        summary,
      });
      return true;
    } catch (error) {
      // 并发推进：只要有别人把边界推过本次位置，本次推进就已经生效。
      const latest = await read_latest_checkpoint(input.derived, this.name);
      if (latest && compare_position(latest, boundary) >= 0) return true;
      throw error;
    }
  }
}

/** 组装当前上下文的只读诊断。 */
function build_diagnostics(
  composer_name: string,
  history: SessionComposeInput["history"],
  checkpoint: ContextCheckpointRow | null,
): SessionContextDiagnostics {
  const latest_sequence = history.at(-1)?.sequence;
  return {
    composer_name,
    ...(latest_sequence !== undefined ? { through_sequence: latest_sequence } : {}),
    ...(checkpoint ? { through_part_sequence: checkpoint.through_part_sequence } : {}),
    derived: Boolean(checkpoint),
    ...(checkpoint ? { derivation_id: checkpoint.checkpoint_id } : {}),
  };
}
