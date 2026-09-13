/**
 * 基于稳定 Part 游标的自适应上下文策略。
 *
 * Message 仍是 canonical 持久化聚合，Part 是上下文取舍与摘要边界。策略只写自己的
 * checkpoint 派生表，不修改 Message；单个 Agent Message 很大时也可以在
 * Message 内部形成摘要边界。
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
import type {
  AdaptivePartCheckpointRow,
  StablePartCandidate,
} from "@/types/session/AdaptivePartContextPolicy.js";
import {
  build_initial_session_summary_prompt,
  build_updated_session_summary_prompt,
  SESSION_SUMMARY_SYSTEM_PROMPT,
} from "@/session/composer/policies/SessionSummaryPrompts.js";

const POLICY_VERSION = 1;
const SUMMARY_MAX_OUTPUT_TOKENS = 4_000;
const CHECKPOINT_TABLE = "composer_adaptive_part_checkpoints";

/** 默认 Part 级上下文策略。 */
export class AdaptivePartContextPolicy implements SessionContextPolicy {
  readonly name = "adaptive_part";

  /** 创建当前策略独享的 checkpoint 表。 */
  async initialize(input: Parameters<SessionContextPolicy["initialize"]>[0]): Promise<void> {
    await input.storage.transaction((transaction) => {
      transaction.execute(`
        CREATE TABLE IF NOT EXISTS ${CHECKPOINT_TABLE} (
          checkpoint_id TEXT PRIMARY KEY,
          through_message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
          through_message_sequence INTEGER NOT NULL,
          through_part_sequence INTEGER NOT NULL,
          summary TEXT NOT NULL,
          policy_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(through_message_sequence, through_part_sequence, policy_version)
        )
      `);
    });
  }

  /** 返回显式摘要 system block 与 Part 边界后的 canonical 历史。 */
  async resolve(input: Parameters<SessionContextPolicy["resolve"]>[0]) {
    const checkpoint = await this.read_latest_checkpoint(input.storage);
    const canonical = await input.storage.list_messages();
    const tail = checkpoint
      ? slice_messages_after_checkpoint(canonical, checkpoint)
      : canonical;
    return {
      messages: await session_messages_to_model_messages(tail, input.project_root),
      ...(checkpoint?.summary.trim()
        ? {
            system_blocks: [{
              source: "session" as const,
              name: "context-summary",
              content: `<session-context-summary>\n${checkpoint.summary}\n</session-context-summary>`,
            }],
          }
        : {}),
      diagnostics: {
        policy_name: this.name,
        ...(canonical.at(-1)?.sequence !== undefined
          ? { through_sequence: canonical.at(-1)?.sequence }
          : {}),
        ...(checkpoint
          ? { through_part_sequence: checkpoint.through_part_sequence }
          : {}),
        derived: Boolean(checkpoint),
        ...(checkpoint ? { derivation_id: checkpoint.checkpoint_id } : {}),
      },
    };
  }

  /** 上下文压力出现时，按体积选择较旧稳定 Part 并合并进累计摘要。 */
  async recover(input: Parameters<SessionContextPolicy["recover"]>[0]): Promise<boolean> {
    if (!input.model) return false;
    const previous = await this.read_latest_checkpoint(input.storage);
    const canonical = await input.storage.list_messages();
    const candidates = collect_stable_parts(canonical, previous);
    const compact_parts = select_compact_parts(candidates);
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
      messages: build_text_model_messages(SESSION_SUMMARY_SYSTEM_PROMPT, prompt),
      max_output_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
    }, {
      request_kind: "history_compaction",
      on_failure: input.on_model_request_failure,
    });
    const summary = String(result.text || "").trim();
    if (!summary) throw new Error("Context summary model returned an empty result");
    const checkpoint_id = `checkpoint:${generate_id()}`;
    try {
      await input.storage.transaction((transaction) => {
        transaction.execute(`
          INSERT INTO ${CHECKPOINT_TABLE} (
            checkpoint_id, through_message_id, through_message_sequence,
            through_part_sequence, summary, policy_version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          checkpoint_id,
          boundary.message.message_id,
          boundary.message.sequence,
          boundary.part.sequence,
          summary,
          POLICY_VERSION,
          Date.now(),
        ]);
      });
      return true;
    } catch (error) {
      const latest = await this.read_latest_checkpoint(input.storage);
      if (latest && compare_position(latest, boundary) >= 0) return true;
      throw error;
    }
  }

  /** 读取当前版本位置最靠后的累计 checkpoint。 */
  private async read_latest_checkpoint(
    storage: Parameters<SessionContextPolicy["resolve"]>[0]["storage"],
  ): Promise<AdaptivePartCheckpointRow | null> {
    return await storage.transaction((transaction) =>
      transaction.get<AdaptivePartCheckpointRow>(`
        SELECT checkpoint_id, through_message_id, through_message_sequence,
               through_part_sequence, summary, policy_version, created_at
        FROM ${CHECKPOINT_TABLE}
        WHERE policy_version = ?
        ORDER BY through_message_sequence DESC, through_part_sequence DESC
        LIMIT 1
      `, [POLICY_VERSION])
    );
  }
}

/** 收集 checkpoint 后适合进入摘要的稳定 Part。 */
function collect_stable_parts(
  messages: readonly SessionMessage[],
  checkpoint: AdaptivePartCheckpointRow | null,
): StablePartCandidate[] {
  return messages.flatMap((message) => message.parts.flatMap((part) => {
    if (checkpoint && compare_part_position(message.sequence, part.sequence, checkpoint) <= 0) {
      return [];
    }
    if (!is_stable_summary_part(message, part)) return [];
    return [{ message, part }];
  }));
}

/** 判断 Part 是否稳定且值得占据累计摘要。 */
function is_stable_summary_part(
  message: SessionMessage,
  part: SessionUserMessagePart | SessionAgentMessagePart,
): boolean {
  switch (part.type) {
    case "reasoning":
    case "action":
      return false;
    case "tool":
      return part.state === "completed" || part.state === "failed";
    case "text":
      if (message.role === "user") return true;
      return "state" in part && part.state === "done" && message.state === "done";
    case "context":
    case "file":
    case "data":
    case "error":
      return true;
    default:
      return assert_never(part);
  }
}

/** 把单个 Part 收窄为摘要模型需要的稳定事实。 */
function candidate_to_summary_text(candidate: StablePartCandidate): string {
  return JSON.stringify({
    role: candidate.message.role,
    message_id: candidate.message.message_id,
    part: summary_part(candidate.part),
  });
}

/** 删除瞬时字段并保留 Tool 调用/结果原子。 */
function summary_part(
  part: SessionUserMessagePart | SessionAgentMessagePart,
): Record<string, unknown> {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "context":
      return { type: "context", tag: part.tag, context: part.context };
    case "file":
      return { type: "file", media_type: part.media_type, url: part.url, filename: part.filename };
    case "data":
      return { type: "data", data_type: part.data_type, data: part.data };
    case "tool":
      return {
        type: "tool",
        tool_name: part.tool_name,
        input: part.input,
        output: part.output,
        error: part.error,
      };
    case "error":
      return { type: "error", code: part.code, message: part.message };
    case "reasoning":
    case "action":
      return { type: part.type };
    default:
      return assert_never(part);
  }
}

/**
 * 选择足以释放约一半原始上下文体积的最旧 Part。
 *
 * 关键点（中文）：Part 数量不能代表上下文压力。一个巨大 Tool/Text Part
 * 可以独自占满窗口，因此使用送入摘要模型的序列化字符体积作为轻量估算，
 * 并保证只有一个可用 Part 时仍能推进 checkpoint。
 */
function select_compact_parts(
  candidates: readonly StablePartCandidate[],
): StablePartCandidate[] {
  if (candidates.length === 0) return [];
  const sizes = candidates.map((candidate) =>
    Math.max(candidate_to_summary_text(candidate).length, 1)
  );
  const target_size = Math.ceil(
    sizes.reduce((total, size) => total + size, 0) / 2,
  );
  let selected_size = 0;
  let selected_count = 0;
  while (selected_count < candidates.length && selected_size < target_size) {
    selected_size += sizes[selected_count] ?? 0;
    selected_count += 1;
  }
  return candidates.slice(0, Math.max(selected_count, 1));
}

/** 删除 checkpoint 以前的 Part；边界可以位于单个 Message 内部。 */
function slice_messages_after_checkpoint(
  messages: readonly SessionMessage[],
  checkpoint: AdaptivePartCheckpointRow,
): SessionMessage[] {
  return messages.flatMap((message): SessionMessage[] => {
    if (message.sequence < checkpoint.through_message_sequence) return [];
    if (message.sequence > checkpoint.through_message_sequence) return [message];
    const parts = message.parts.filter(
      (part) => part.sequence > checkpoint.through_part_sequence,
    );
    if (parts.length === 0) return [];
    return [{ ...message, parts } as SessionMessage];
  });
}

/** 比较 canonical Part 与 checkpoint 的全局线性位置。 */
function compare_part_position(
  message_sequence: number,
  part_sequence: number,
  checkpoint: AdaptivePartCheckpointRow,
): number {
  if (message_sequence !== checkpoint.through_message_sequence) {
    return message_sequence - checkpoint.through_message_sequence;
  }
  return part_sequence - checkpoint.through_part_sequence;
}

/** 比较 checkpoint 与候选边界。 */
function compare_position(
  checkpoint: AdaptivePartCheckpointRow,
  candidate: StablePartCandidate,
): number {
  return -compare_part_position(
    candidate.message.sequence,
    candidate.part.sequence,
    checkpoint,
  );
}

/** canonical Part 联合类型新增成员时强制摘要策略显式选择语义。 */
function assert_never(value: never): never {
  throw new Error(`Unsupported summary Session Part: ${String((value as { type?: unknown }).type)}`);
}
