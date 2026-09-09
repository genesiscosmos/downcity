/**
 * 基于 Message sequence 的累计摘要上下文策略。
 *
 * canonical Message 永远保留在核心表中；本策略只向自己的派生表追加累计摘要，
 * 正常读取时使用“最新摘要 + 摘要边界后的完整 Message”。
 */

import type {
  SessionAgentMessagePart,
  SessionMessage,
  SessionUserMessagePart,
} from "@downcity/type";
import { generate_id } from "@/utils/Id.js";
import { build_text_model_messages, generate_model } from "@executor/model/ModelGenerate.js";
import { session_messages_to_model_messages } from "@/executor/messages/SessionModelMessages.js";
import type { SessionContextPolicy } from "@/types/session/SessionContextPolicy.js";
import {
  build_initial_session_summary_prompt,
  build_updated_session_summary_prompt,
  SESSION_SUMMARY_SYSTEM_PROMPT,
} from "@/session/composer/policies/SessionSummaryPrompts.js";

const SUMMARY_MAX_OUTPUT_TOKENS = 4_000;
const POLICY_VERSION = 1;
const SUMMARY_TABLE = "composer_sequence_summaries";

/** sequence summary 派生行。 */
interface SequenceSummaryRow {
  /** 派生摘要标识。 */
  summary_id: string;
  /** 摘要覆盖到的 Message 标识。 */
  through_message_id: string;
  /** 摘要覆盖到的 Message sequence。 */
  through_sequence: number;
  /** 累计摘要正文。 */
  summary: string;
  /** 生成该行的策略版本。 */
  policy_version: number;
  /** 派生行创建时间。 */
  created_at: number;
}

/** 默认累计摘要 Context Policy。 */
export class SequenceSummaryContextPolicy implements SessionContextPolicy {
  readonly name = "sequence";

  /** 创建仅属于本策略的派生摘要表。 */
  async initialize(input: Parameters<SessionContextPolicy["initialize"]>[0]): Promise<void> {
    await input.storage.transaction((transaction) => {
      transaction.execute(`
        CREATE TABLE IF NOT EXISTS ${SUMMARY_TABLE} (
          summary_id TEXT PRIMARY KEY,
          through_message_id TEXT NOT NULL
            REFERENCES messages(message_id) ON DELETE CASCADE,
          through_sequence INTEGER NOT NULL UNIQUE,
          summary TEXT NOT NULL,
          policy_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
    });
  }

  /** 返回最新累计摘要与边界后的完整 canonical history。 */
  async resolve(input: Parameters<SessionContextPolicy["resolve"]>[0]) {
    const summary = await this.read_latest_summary(input.storage);
    const canonical = await input.storage.list_messages();
    const tail = summary
      ? canonical.filter((message) => message.sequence > summary.through_sequence)
      : canonical;
    const messages = await session_messages_to_model_messages(tail, input.project_root);
    if (summary?.summary.trim()) {
      messages.unshift({
        role: "assistant",
        content: [{ type: "text", text: summary.summary }],
      });
    }
    return {
      messages,
      diagnostics: {
        policy_name: this.name,
        ...(canonical.at(-1)?.sequence !== undefined
          ? { through_sequence: canonical.at(-1)?.sequence }
          : {}),
        derived: Boolean(summary),
        ...(summary ? { derivation_id: summary.summary_id } : {}),
      },
    };
  }

  /** 在上下文超限时生成一个新的累计摘要边界。 */
  async recover(input: Parameters<SessionContextPolicy["recover"]>[0]): Promise<boolean> {
    if (!is_context_limit_error(input.error) || !input.model) return false;
    const previous = await this.read_latest_summary(input.storage);
    const canonical = await input.storage.list_messages();
    const candidates = canonical.filter((message) =>
      message.sequence > (previous?.through_sequence ?? 0) &&
      (message.role === "user" || message.status !== "streaming")
    );
    const compact_count = Math.floor(candidates.length / 2);
    if (compact_count <= 0) return false;
    const compact_messages = candidates.slice(0, compact_count);
    const boundary = compact_messages.at(-1);
    if (!boundary) return false;
    const conversation_text = compact_messages
      .map(message_to_summary_text)
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
      messages: build_text_model_messages(SESSION_SUMMARY_SYSTEM_PROMPT, prompt),
      max_output_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
    }, {
      request_kind: "history_compaction",
      on_failure: input.on_model_request_failure,
    });
    const summary = String(result.text || "").trim();
    if (!summary) throw new Error("Context summary model returned an empty result");
    try {
      await input.storage.transaction((transaction) => {
        transaction.execute(`
          INSERT INTO ${SUMMARY_TABLE} (
            summary_id, through_message_id, through_sequence,
            summary, policy_version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
          `summary:${generate_id()}`,
          boundary.message_id,
          boundary.sequence,
          summary,
          POLICY_VERSION,
          Date.now(),
        ]);
      });
      return true;
    } catch (error) {
      const latest = await this.read_latest_summary(input.storage);
      if (latest && latest.through_sequence >= boundary.sequence) return true;
      throw error;
    }
  }

  /** 读取与当前策略版本兼容的最新累计摘要。 */
  private async read_latest_summary(
    storage: Parameters<SessionContextPolicy["resolve"]>[0]["storage"],
  ): Promise<SequenceSummaryRow | null> {
    return await storage.transaction((transaction) => transaction.get<SequenceSummaryRow>(`
      SELECT summary_id, through_message_id, through_sequence,
             summary, policy_version, created_at
      FROM ${SUMMARY_TABLE}
      WHERE policy_version = ?
      ORDER BY through_sequence DESC
      LIMIT 1
    `, [POLICY_VERSION]));
  }
}

/** 判断 Provider 错误是否表达上下文窗口超限。 */
function is_context_limit_error(error: unknown): boolean {
  const message = String(error ?? "").toLowerCase();
  return message.includes("context_length") ||
    message.includes("too long") ||
    message.includes("maximum context") ||
    message.includes("context window");
}

/** 把 Message 收窄为摘要模型需要的稳定事实。 */
function message_to_summary_text(message: SessionMessage): string {
  return JSON.stringify({
    role: message.role,
    parts: message.parts.map(to_summary_part).filter((part) => part !== null),
  });
}

/** 去除不适合进入累计摘要的瞬时 Part 字段。 */
function to_summary_part(
  part: SessionUserMessagePart | SessionAgentMessagePart,
): Record<string, unknown> | null {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "context") return { type: "context", tag: part.tag, context: part.context };
  if (part.type === "reasoning" || part.type === "interaction") return null;
  if (part.type === "file") {
    return {
      type: "file",
      media_type: part.media_type,
      url: part.url,
      ...(part.filename ? { filename: part.filename } : {}),
    };
  }
  if (part.type === "data") return { type: "data", data_type: part.data_type, data: part.data };
  if (part.type === "tool") {
    return {
      type: "tool",
      tool_name: part.tool_name,
      input: part.input,
      output: part.output,
      error: part.error,
    };
  }
  if (part.type === "action") {
    return { type: "action", title: part.title, description: part.description, state: part.state };
  }
  if (part.type === "error") return { type: "error", code: part.code, message: part.message };
  return null;
}
