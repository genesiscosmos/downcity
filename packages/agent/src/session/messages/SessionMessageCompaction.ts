/**
 * SessionMessages Active/Segment 上下文压缩计划生成。
 *
 * 关键点（中文）
 * - 按 Active 中 User/Assistant Message 数量选择最旧的 `floor(n / 2)` 条。
 * - 旧累计 Summary 与选中前缀只执行一次摘要模型调用。
 * - 较新的消息不进入摘要输入；摘要失败时不生成计划、不修改 canonical history。
 * - 成功计划由 SessionMessages 把连续 Active 前缀写入不可变 Segment，并保存累计 Summary。
 */

import type { ModelClient } from "@downcity/type";
import type { ModelRequestFailureReporter } from "@/types/executor/ModelRequest.js";
import {
  build_text_model_messages,
  generate_model,
} from "@executor/model/ModelGenerate.js";
import { generate_id } from "@/utils/Id.js";
import {
  build_initial_session_compaction_prompt,
  build_update_session_compaction_prompt,
  SESSION_COMPACTION_SYSTEM_PROMPT,
} from "@executor/composer/compaction/jsonl/JsonlSessionCompactionPrompts.js";
import type {
  SessionAgentMessagePart,
  SessionMessage,
  SessionUserMessagePart,
} from "@downcity/type";
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
  model: ModelClient;
  /** 可选的模型请求逐次失败通知入口。 */
  on_model_request_failure?: ModelRequestFailureReporter;
}): Promise<SessionCompactionPlan | null> {
  const context_messages = input.snapshot.messages.filter(
    (message) => message.type === "user" || message.type === "agent",
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
  const result = await generate_model(input.model, {
    messages: build_text_model_messages(SESSION_COMPACTION_SYSTEM_PROMPT, prompt),
    max_output_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
  }, {
    request_kind: "history_compaction",
    on_failure: input.on_model_request_failure,
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
  if (message.type !== "user" && message.type !== "agent") return "";
  const parts = message.parts
    .map(to_compaction_part)
    .filter((part) => part !== null);
  return safe_stringify({
    role: message.type,
    parts,
  });
}

/** 把 canonical Part 收窄为 Summary 模型需要的稳定会话事实。 */
function to_compaction_part(
  part: SessionUserMessagePart | SessionAgentMessagePart,
): Record<string, unknown> | null {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "context") {
    return {
      type: "context",
      tag: part.tag,
      context: part.context,
    };
  }
  if (part.type === "reasoning" || part.type === "interaction") return null;
  if (part.type === "file") {
    return {
      type: "file",
      media_type: part.media_type,
      url: part.url,
      ...(part.filename ? { filename: part.filename } : {}),
    };
  }
  if (part.type === "data") {
    return {
      type: "data",
      data_type: part.data_type,
      data: part.data,
      ...(part.data_id ? { data_id: part.data_id } : {}),
    };
  }
  if (part.type === "tool") {
    return {
      type: "tool",
      tool_call_id: part.tool_call_id,
      tool_name: part.tool_name,
      state: part.state,
      ...(part.input !== undefined ? { input: part.input } : {}),
      ...(part.output !== undefined ? { output: part.output } : {}),
      ...(part.error ? { error: part.error } : {}),
    };
  }
  return null;
}

function safe_stringify(value: unknown): string {
  try {
    return JSON.stringify(value) || String(value || "");
  } catch {
    return String(value || "");
  }
}
