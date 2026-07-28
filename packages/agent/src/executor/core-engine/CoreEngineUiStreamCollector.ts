/**
 * Session UI stream 最终消息收敛器。
 *
 * 关键点（中文）
 * - 必须完整消费 AI SDK UI stream，才能稳定触发 `onFinish`。
 * - 优先使用结构化 `responseMessage`；缺失时才回退到纯文本。
 * - UI chunk 回调负责上层 canonical message 写入，失败必须终止本轮收敛。
 */

import type { streamText } from "ai";
import type { Logger } from "@/utils/logger/Logger.js";
import type { JsonObject } from "@/types/common/Json.js";
import type { SessionMessageRecordV1 } from "@/executor/types/SessionRecords.js";
import type { SessionUiMessageChunkCallback } from "@/types/session/SessionExecution.js";
import { generate_id } from "@/utils/Id.js";
import {
  summarize_ui_message_for_debug,
  to_inline_preview,
} from "@executor/core-engine/CoreEngineSignals.js";

/**
 * 收敛 UI stream 中的最终 assistant 消息。
 */
export async function collect_final_assistant_message_from_ui_stream(params: {
  /**
   * 当前 `streamText` 执行结果。
   */
  result: ReturnType<typeof streamText>;
  /**
   * 当前 session_id，用于日志关联。
   */
  session_id: string;
  /**
   * 当前日志器。
   */
  logger: Logger;
  /**
   * 构造 fallback assistant 消息的工厂函数。
   */
  buildFallbackAssistantMessage: (text: string) => SessionMessageRecordV1;
  /**
   * UI stream chunk 回调。
   */
  on_ui_message_chunk_callback?: SessionUiMessageChunkCallback;
  /**
   * 当前 turn 的取消信号。
   *
   * 关键点（中文）
   * - stop 触发后，UI stream 可能在 onFinish 前中断。
   * - 此时仍应尽量用已经收到的 text delta 构造可持久化 assistant 消息。
   */
  abort_signal?: AbortSignal;
}): Promise<SessionMessageRecordV1> {
  let streamedAssistantMessage: SessionMessageRecordV1 | null = null;
  let uiFinishSummary: JsonObject | null = null;
  let streamed_text = "";
  let callback_failed = false;

  const uiStream = params.result.toUIMessageStream<SessionMessageRecordV1>({
    // 关键点（中文）：SDK stream 需要 reasoning 旁路事件时可直接消费；最终落盘仍由 responseMessage 收敛。
    originalMessages: [],
    generateMessageId: () => `a:${params.session_id}:${generate_id()}`,
    messageMetadata: ({ part }) => {
      if (part.type !== "start" && part.type !== "finish") return undefined;
      return {
        v: 1,
        ts: Date.now(),
        session_id: params.session_id,
        source: "egress",
        kind: "normal",
      };
    },
    sendReasoning: true,
    sendSources: false,
    onFinish: (event) => {
      streamedAssistantMessage = event.responseMessage ?? null;
      uiFinishSummary = {
        isContinuation: event.isContinuation,
        isAborted: event.isAborted,
        finishReason:
          typeof event.finishReason === "string" ? event.finishReason : null,
        ...summarize_ui_message_for_debug(event.responseMessage),
      };
    },
  });

  try {
    for await (const chunk of uiStream) {
      if (chunk.type === "text-delta") {
        streamed_text += String(chunk.delta || "");
      }
      if (typeof params.on_ui_message_chunk_callback !== "function") continue;
      try {
        await params.on_ui_message_chunk_callback(chunk);
      } catch (error) {
        callback_failed = true;
        throw error;
      }
    }
  } catch (error) {
    if (callback_failed || !params.abort_signal?.aborted) {
      throw error;
    }
  }

  await params.logger.log("info", "[agent] ui.finish", {
    session_id: params.session_id,
    ...(uiFinishSummary || {
      responseMessageMissing: true,
    }),
  });

  if (streamedAssistantMessage) return streamedAssistantMessage;

  let assistantText = "";
  try {
    assistantText = String((await params.result.text) ?? "").trim();
  } catch {
    assistantText = "";
  }
  if (!assistantText) {
    assistantText = streamed_text.trim();
  }

  await params.logger.log("warn", "[agent] final.message.fallback", {
    session_id: params.session_id,
    assistantTextLength: assistantText.length,
    assistantTextPreview: to_inline_preview(assistantText),
  });

  return params.buildFallbackAssistantMessage(
    assistantText || "Execution completed",
  );
}
