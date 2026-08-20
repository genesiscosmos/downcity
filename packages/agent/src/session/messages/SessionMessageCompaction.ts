/**
 * SessionMessages Active/Segment 上下文压缩计划生成。
 *
 * 关键点（中文）
 * - 按 Active 中 User/Assistant Message 数量选择最旧的 `floor(n / 2)` 条。
 * - 旧累计 Summary 与选中前缀只执行一次摘要模型调用。
 * - 较新的消息不进入摘要输入；摘要失败时不生成计划、不修改 canonical history。
 * - 成功计划由 SessionMessages 把连续 Active 前缀写入不可变 Segment，并保存累计 Summary。
 */

import { generateText, type LanguageModel } from "ai";
import { generate_id } from "@/utils/Id.js";
import {
  build_initial_session_compaction_prompt,
  build_update_session_compaction_prompt,
  SESSION_COMPACTION_SYSTEM_PROMPT,
} from "@executor/composer/compaction/jsonl/JsonlSessionCompactionPrompts.js";
import { to_executor_ui_message } from "@/session/messages/SessionMessageCodec.js";
import type { SessionMessage } from "@/types/session/SessionMessage.js";
import type {
  SessionCompactionPlan,
} from "@/types/session/SessionComposer.js";
import type { SessionContextSnapshot } from "@/types/session/SessionSegment.js";

/** 摘要模型的最大输出 token，用于避免 Summary 自身无限增长。 */
const SUMMARY_MAX_OUTPUT_TOKENS = 4_000;

/**
 * 根据只读 Message 快照生成持久化压缩计划。
 *
 * 该函数可以调用模型生成 Summary，但不会写文件、修改 Recorder 或发布事件。
 */
export async function compose_session_compaction(input: {
  /** 当前 Session 标识。 */
  session_id: string;
  /** 当前累计 Summary 与 Active Message 快照。 */
  snapshot: Readonly<SessionContextSnapshot>;
  /** 生成累计 Summary 使用的模型。 */
  model: LanguageModel;
}): Promise<SessionCompactionPlan | null> {
  const context_messages = input.snapshot.messages.filter(
    (message) => message.type === "user" || message.type === "assistant",
  );
  const compact_message_count = Math.floor(context_messages.length / 2);
  if (compact_message_count <= 0) return null;
  const compact_messages = context_messages.slice(0, compact_message_count);
  const boundary = compact_messages.at(-1);
  if (!boundary) return null;

  const conversation_text = compact_messages
    .map((message) => message_to_compaction_text(message))
    .filter(Boolean)
    .join("\n");
  if (!conversation_text) {
    throw new Error("Compaction requires non-empty Message context");
  }
  const previous_summary = String(input.snapshot.summary?.text || "").trim();
  const prompt = previous_summary
    ? build_update_session_compaction_prompt({
        previous_summary,
        new_conversation_text: conversation_text,
      })
    : build_initial_session_compaction_prompt({ conversation_text });
  const result = await generateText({
    model: input.model,
    system: [{ role: "system", content: SESSION_COMPACTION_SYSTEM_PROMPT }],
    prompt,
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
  });
  const summary = String(result.text || "").trim();
  if (!summary) {
    throw new Error("Compaction model returned an empty Summary");
  }

  return {
    through_sequence: boundary.sequence,
    boundary_message_id: boundary.message_id,
    summary: {
      record_type: "summary",
      session_id: input.session_id,
      summary_id: `summary:${input.session_id}:${generate_id()}`,
      through_sequence: boundary.sequence,
      text: summary,
      created_at: Date.now(),
    },
  };
}

function message_to_compaction_text(message: SessionMessage): string {
  const projected = to_executor_ui_message(message);
  if (!projected) return "";
  const parts = projected.parts
    .filter((part) => part.type !== "reasoning");
  return safe_stringify({
    role: projected.role,
    parts,
  });
}

function safe_stringify(value: unknown): string {
  try {
    return JSON.stringify(value) || String(value || "");
  } catch {
    return String(value || "");
  }
}
