/**
 * SessionMessages Active/Segment 上下文压缩计划生成。
 *
 * Compact 把 Active 前缀写入不可变 Segment，并在 footer 保存累计 Summary。
 */

import { generateText, type LanguageModel } from "ai";
import { generate_id } from "@/utils/Id.js";
import {
  build_initial_session_compaction_prompt,
  build_update_session_compaction_prompt,
  SESSION_COMPACTION_SYSTEM_PROMPT,
} from "@executor/composer/compaction/jsonl/JsonlSessionCompactionPrompts.js";
import { fold_compacted_text } from "@executor/core-engine/CoreEngineContextCompaction.js";
import { to_executor_ui_message } from "@/session/messages/SessionMessageCodec.js";
import type { SessionMessage } from "@/types/session/SessionMessage.js";
import type {
  SessionCompactionPlan,
} from "@/types/session/SessionComposer.js";
import type { SessionContextSnapshot } from "@/types/session/SessionSegment.js";

/** 单次摘要请求中 conversation 文本的最大字符数。 */
const SUMMARY_CHUNK_MAX_CHARS = 20_000;

/** 单条 canonical Message 投影到摘要输入后的最大字符数。 */
const SUMMARY_MESSAGE_MAX_CHARS = 12_000;

/** 上一轮累计 Summary 进入下一次 reduce 请求时的最大字符数。 */
const PREVIOUS_SUMMARY_MAX_CHARS = 12_000;

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
  const boundary = context_messages.at(-1);
  if (!boundary) return null;

  const conversation_messages = context_messages
    .map((message) => message_to_compaction_text(message))
    .filter(Boolean);
  const chunks = build_summary_chunks(conversation_messages);
  let summary = String(input.snapshot.summary?.text || "").trim();
  let used_fallback = false;
  for (const chunk of chunks) {
    const prompt = summary
      ? build_update_session_compaction_prompt({
          previous_summary: fold_compacted_text(
            summary,
            PREVIOUS_SUMMARY_MAX_CHARS,
          ),
          new_conversation_text: chunk || "(none)",
        })
      : build_initial_session_compaction_prompt({
          conversation_text: chunk || "(none)",
        });
    try {
      const result = await generateText({
        model: input.model,
        system: [{ role: "system", content: SESSION_COMPACTION_SYSTEM_PROMPT }],
        prompt,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      });
      const next_summary = String(result.text || "").trim();
      if (!next_summary) throw new Error("Compaction model returned an empty Summary");
      summary = next_summary;
    } catch {
      used_fallback = true;
      summary = build_deterministic_summary(summary, chunk);
    }
  }
  if (!summary) {
    used_fallback = true;
    summary = build_deterministic_summary("", "(no textual context)");
  }

  return {
    through_sequence: boundary.sequence,
    boundary_message_id: boundary.message_id,
    used_fallback,
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
    .filter((part) => part.type !== "reasoning")
    .map((part) => {
      const serialized = safe_stringify(part);
      return serialized.length <= SUMMARY_MESSAGE_MAX_CHARS
        ? part
        : {
            type: part.type,
            compacted_preview: fold_compacted_text(
              serialized,
              SUMMARY_MESSAGE_MAX_CHARS,
            ),
          };
    });
  return fold_compacted_text(safe_stringify({
    role: projected.role,
    parts,
  }), SUMMARY_MESSAGE_MAX_CHARS);
}

/** 按 Message 边界把摘要输入拆为固定字符上限的 chunk。 */
function build_summary_chunks(messages: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const message of messages) {
    const value = fold_compacted_text(message, SUMMARY_CHUNK_MAX_CHARS);
    const candidate = current ? `${current}\n${value}` : value;
    if (current && candidate.length > SUMMARY_CHUNK_MAX_CHARS) {
      chunks.push(current);
      current = value;
      continue;
    }
    current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** 摘要模型不可用时仍可完成归档的确定性 checkpoint。 */
function build_deterministic_summary(
  previous_summary: string,
  new_context: string,
): string {
  const body = [
    String(previous_summary || "").trim(),
    String(new_context || "").trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    "## Compacted Context",
    "The summary model was unavailable. The following deterministic checkpoint preserves the beginning and latest context.",
    "",
    fold_compacted_text(body || "(none)", PREVIOUS_SUMMARY_MAX_CHARS),
  ].join("\n");
}

function safe_stringify(value: unknown): string {
  try {
    return JSON.stringify(value) || String(value || "");
  } catch {
    return String(value || "");
  }
}
