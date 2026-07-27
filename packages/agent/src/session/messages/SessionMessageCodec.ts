/**
 * SessionMessage 与 AI SDK UIMessage 的内部投影转换。
 *
 * 关键点（中文）
 * - SessionMessage 是唯一持久化事实；UIMessage 只在 Executor/Composer 边界临时构造。
 * - action/error 不转换为模型消息。
 * - part_id 只服务 Session Message identity，不传入模型协议。
 */

import type { UIMessage } from "ai";
import {
  to_session_json_object,
  to_session_json_value,
  to_session_provider_metadata,
} from "@/session/messages/SessionJsonValue.js";
import type {
  SessionAssistantMessage,
  SessionAssistantMessagePart,
  SessionMessage,
  SessionUserMessage,
  SessionUserMessagePart,
} from "@/types/session/SessionMessage.js";
import type {
  SessionMessageRecordV1,
  SessionMetadataV1,
  SessionRecordV1,
} from "@/executor/types/SessionRecords.js";
import type { SessionContextSnapshot } from "@/types/session/SessionSegment.js";

/** 把 canonical Session 历史快照投影为内部 UIMessage records。 */
export function to_executor_history(
  session_id: string,
  snapshot: Readonly<SessionContextSnapshot>,
): SessionRecordV1[] {
  const records: SessionRecordV1[] = [];
  if (snapshot.summary) {
    records.push({
      id: snapshot.summary.summary_id,
      role: "assistant",
      metadata: {
        v: 1,
        ts: snapshot.summary.created_at,
        session_id: session_id,
        source: "compact",
        kind: "summary",
        extra: {
          visibility: "internal",
          summaryThroughSequence: snapshot.summary.through_sequence,
        },
      },
      parts: [{ type: "text", text: snapshot.summary.text }],
    });
  }
  for (const message of snapshot.messages) {
    const record = to_executor_ui_message(message);
    if (record) records.push(record);
  }
  return records;
}

/** 把 Session Message 投影成 Executor 可消费的 UIMessage。 */
export function to_executor_ui_message(
  message: SessionMessage,
): SessionMessageRecordV1 | null {
  if (message.type !== "user" && message.type !== "assistant") return null;
  const metadata: SessionMetadataV1 = {
    v: 1,
    ts: message.updated_at,
    session_id: message.session_id,
    turn_id: message.turn_id,
    source:
      message.type === "user"
        ? "ingress"
        : message.kind === "summary"
          ? "compact"
          : "egress",
    kind:
      message.type === "assistant" && message.kind === "summary"
        ? "summary"
        : "normal",
    extra: {
      sequence: message.sequence,
      revision: message.revision,
      visibility: message.visibility,
      ...(message.type === "user"
        ? { inputType: message.input_type }
        : { status: message.status }),
    },
  };
  return {
    id: message.message_id,
    role: message.type,
    metadata,
    parts:
      message.type === "user"
        ? to_ui_user_parts(message.parts)
        : to_ui_assistant_parts(message.parts),
  } as SessionMessageRecordV1;
}

/** 把 AI SDK user parts 转换成可持久化 Session parts。 */
export function from_ui_user_parts(
  parts: UIMessage["parts"] | null | undefined,
): SessionUserMessagePart[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap<SessionUserMessagePart>((part, index) => {
    if (!part || typeof part !== "object") return [];
    const candidate = part as Record<string, unknown>;
    if (candidate.type === "text") {
      const provider_metadata = to_session_provider_metadata(candidate.providerMetadata);
      return [{
        part_id: `user-text:${index + 1}`,
        type: "text" as const,
        text: String(candidate.text || ""),
        state: "done" as const,
        ...(provider_metadata !== undefined ? { provider_metadata } : {}),
      }];
    }
    if (candidate.type === "file") {
      const provider_metadata = to_session_provider_metadata(candidate.providerMetadata);
      return [{
        part_id: `user-file:${index + 1}`,
        type: "file" as const,
        url: String(candidate.url || ""),
        media_type: String(candidate.mediaType || "application/octet-stream"),
        ...(typeof candidate.filename === "string"
          ? { filename: candidate.filename }
          : {}),
        ...(provider_metadata !== undefined ? { provider_metadata } : {}),
      }];
    }
    if (String(candidate.type || "").startsWith("data-")) {
      const data_id = typeof candidate.id === "string" ? candidate.id : undefined;
      return [{
        part_id: `user-data:${index + 1}`,
        type: "data" as const,
        data_type: String(candidate.type),
        data: to_session_json_value(candidate.data),
        ...(data_id !== undefined ? { data_id } : {}),
      }];
    }
    return [];
  });
}

/** 把最终 AI SDK assistant parts 转换成 Session parts。 */
export function from_ui_assistant_parts(
  parts: UIMessage["parts"] | null | undefined,
): SessionAssistantMessagePart[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap<SessionAssistantMessagePart>((part, index) => {
    if (!part || typeof part !== "object") return [];
    const candidate = part as Record<string, unknown>;
    const type = String(candidate.type || "");
    if (type === "text" || type === "reasoning") {
      const text = String(candidate.text || "");
      // 关键点（中文）：AI SDK 会为只有 start/end、没有 delta 的流生成空占位 Part。
      // canonical history 不保存无内容的协议占位，避免与只按 delta 创建 Part 的 writer 分叉。
      if (text.length === 0) return [];
      const provider_metadata = to_session_provider_metadata(candidate.providerMetadata);
      return [{
        part_id: `${type}:${index + 1}`,
        sequence: index + 1,
        type: type as "text" | "reasoning",
        text,
        state: candidate.state === "streaming" ? "streaming" as const : "done" as const,
        ...(provider_metadata !== undefined ? { provider_metadata } : {}),
      }];
    }
    if (type === "file") {
      const provider_metadata = to_session_provider_metadata(candidate.providerMetadata);
      return [{
        part_id: `file:${index + 1}`,
        sequence: index + 1,
        type: "file" as const,
        url: String(candidate.url || ""),
        media_type: String(candidate.mediaType || "application/octet-stream"),
        ...(typeof candidate.filename === "string"
          ? { filename: candidate.filename }
          : {}),
        ...(provider_metadata !== undefined ? { provider_metadata } : {}),
      }];
    }
    if (type === "source-url") {
      const provider_metadata = to_session_provider_metadata(candidate.providerMetadata);
      return [{
        part_id: `source:${String(candidate.sourceId || index + 1)}`,
        sequence: index + 1,
        type: "source" as const,
        source_type: "url" as const,
        source_id: String(candidate.sourceId || `source-${index + 1}`),
        url: String(candidate.url || ""),
        ...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
        ...(provider_metadata !== undefined ? { provider_metadata } : {}),
      }];
    }
    if (type === "source-document") {
      const provider_metadata = to_session_provider_metadata(candidate.providerMetadata);
      return [{
        part_id: `source:${String(candidate.sourceId || index + 1)}`,
        sequence: index + 1,
        type: "source" as const,
        source_type: "document" as const,
        source_id: String(candidate.sourceId || `source-${index + 1}`),
        media_type: String(candidate.mediaType || "application/octet-stream"),
        title: candidate.title === undefined || candidate.title === null
          ? "Document"
          : String(candidate.title),
        ...(typeof candidate.filename === "string"
          ? { filename: candidate.filename }
          : {}),
        ...(provider_metadata !== undefined ? { provider_metadata } : {}),
      }];
    }
    if (type === "step-start") {
      return [{
        part_id: `step:${index + 1}`,
        sequence: index + 1,
        type: "step-start" as const,
      }];
    }
    if (type === "dynamic-tool" || type.startsWith("tool-")) {
      const state = String(candidate.state || "");
      const call_provider_metadata = to_session_provider_metadata(
        candidate.callProviderMetadata,
      );
      const result_provider_metadata = to_session_provider_metadata(
        candidate.resultProviderMetadata,
      );
      const tool_metadata = to_session_json_object(candidate.toolMetadata);
      return [{
        part_id: String(candidate.toolCallId || `tool:${index + 1}`),
        sequence: index + 1,
        type: "tool" as const,
        tool_call_id: String(candidate.toolCallId || `tool:${index + 1}`),
        tool_name:
          String(candidate.toolName || "").trim() ||
          type.replace(/^tool-/, "") ||
          "unknown",
        state:
          state === "output-available"
            ? "completed" as const
            : state === "output-error" || state === "output-denied"
              ? "failed" as const
              : state === "approval-requested"
                ? "waiting-user" as const
                : state === "input-streaming"
                  ? "input-streaming" as const
                  : state === "input-available"
                    ? "ready" as const
                    : "running" as const,
        ...(candidate.input !== undefined
          ? { input: to_session_json_value(candidate.input) }
          : {}),
        ...(candidate.output !== undefined
          ? { output: to_session_json_value(candidate.output) }
          : {}),
        ...(typeof candidate.errorText === "string"
          ? { error: candidate.errorText }
          : {}),
        ...(candidate.rawInput !== undefined
          ? { raw_input: to_session_json_value(candidate.rawInput) }
          : {}),
        ...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
        ...(tool_metadata !== undefined ? { tool_metadata } : {}),
        ...(typeof candidate.dynamic === "boolean"
          ? { dynamic: candidate.dynamic }
          : { dynamic: type === "dynamic-tool" }),
        ...(typeof candidate.preliminary === "boolean"
          ? { preliminary: candidate.preliminary }
          : {}),
        ...(call_provider_metadata !== undefined
          ? { call_provider_metadata }
          : {}),
        ...(result_provider_metadata !== undefined
          ? { result_provider_metadata }
          : {}),
        ...(typeof candidate.providerExecuted === "boolean"
          ? { provider_executed: candidate.providerExecuted }
          : {}),
      }];
    }
    if (type.startsWith("data-")) {
      const data_id = typeof candidate.id === "string" ? candidate.id : undefined;
      return [{
        part_id: `data:${data_id ?? String(index + 1)}`,
        sequence: index + 1,
        type: "data" as const,
        data_type: type,
        data: to_session_json_value(candidate.data),
        ...(data_id !== undefined ? { data_id } : {}),
      }];
    }
    return [];
  });
}

/** 提取 Assistant Message 的最终可见文本。 */
export function extract_session_assistant_text(
  message: SessionAssistantMessage | null | undefined,
): string {
  if (!message) return "";
  return message.parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("")
    .trim();
}

function to_ui_user_parts(parts: SessionUserMessagePart[]): UIMessage["parts"] {
  return parts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        text: part.text,
        state: part.state,
        ...(part.provider_metadata !== undefined
          ? { providerMetadata: part.provider_metadata }
          : {}),
      };
    }
    if (part.type === "file") {
      return {
        type: "file",
        url: part.url,
        mediaType: part.media_type,
        ...(part.filename !== undefined ? { filename: part.filename } : {}),
        ...(part.provider_metadata !== undefined
          ? { providerMetadata: part.provider_metadata }
          : {}),
      };
    }
    return {
      type: part.data_type,
      data: part.data,
      ...(part.data_id !== undefined ? { id: part.data_id } : {}),
    } as UIMessage["parts"][number];
  });
}

function to_ui_assistant_parts(
  parts: SessionAssistantMessagePart[],
): UIMessage["parts"] {
  return parts.map((part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return {
        type: part.type,
        text: part.text,
        state: part.state,
        ...(part.provider_metadata !== undefined
          ? { providerMetadata: part.provider_metadata }
          : {}),
      };
    }
    if (part.type === "file") {
      return {
        type: "file",
        url: part.url,
        mediaType: part.media_type,
        ...(part.filename !== undefined ? { filename: part.filename } : {}),
        ...(part.provider_metadata !== undefined
          ? { providerMetadata: part.provider_metadata }
          : {}),
      };
    }
    if (part.type === "data") {
      return {
        type: part.data_type,
        data: part.data,
        ...(part.data_id !== undefined ? { id: part.data_id } : {}),
      } as UIMessage["parts"][number];
    }
    if (part.type === "source") {
      if (part.source_type === "url") {
        return {
          type: "source-url",
          sourceId: part.source_id,
          url: part.url,
          ...(part.title !== undefined ? { title: part.title } : {}),
          ...(part.provider_metadata !== undefined
            ? { providerMetadata: part.provider_metadata }
            : {}),
        };
      }
      return {
        type: "source-document",
        sourceId: part.source_id,
        mediaType: part.media_type,
        title: part.title,
        ...(part.filename !== undefined ? { filename: part.filename } : {}),
        ...(part.provider_metadata !== undefined
          ? { providerMetadata: part.provider_metadata }
          : {}),
      };
    }
    if (part.type === "step-start") {
      return { type: "step-start" };
    }
    if (part.type === "interaction") {
      return {
        type: "data-session-interaction",
        id: part.interaction_id,
        data: {
          interaction_id: part.interaction_id,
          interaction_type: part.interaction_type,
          status: part.status,
          request: part.request,
          ...(part.response !== undefined ? { response: part.response } : {}),
          ...(part.resolved_at !== undefined
            ? { resolved_at: part.resolved_at }
            : {}),
          ...(part.cancel_reason !== undefined
            ? { cancel_reason: part.cancel_reason }
            : {}),
        },
      } as UIMessage["parts"][number];
    }
    if (!("tool_call_id" in part)) {
      throw new Error(`Unsupported Assistant part: ${part.type}`);
    }
    const has_input = part.input !== undefined || part.input_text !== undefined;
    const input = part.input !== undefined
      ? part.input
      : part.input_text !== undefined
        ? parse_json(part.input_text)
        : part.raw_input !== undefined
          ? undefined
          : {};
    const tool_identity_fields = part.dynamic === false
      ? { type: `tool-${part.tool_name}` }
      : { type: "dynamic-tool", toolName: part.tool_name };
    const call_provider_fields = {
      ...(part.call_provider_metadata !== undefined
        ? { callProviderMetadata: part.call_provider_metadata }
        : {}),
      ...(part.provider_executed !== undefined
        ? { providerExecuted: part.provider_executed }
        : {}),
      ...(part.title !== undefined ? { title: part.title } : {}),
      ...(part.tool_metadata !== undefined
        ? { toolMetadata: part.tool_metadata }
        : {}),
    };
    if (part.state === "completed") {
      return {
        ...tool_identity_fields,
        toolCallId: part.tool_call_id,
        state: "output-available",
        input,
        output: part.output,
        ...call_provider_fields,
        ...(part.preliminary !== undefined
          ? { preliminary: part.preliminary }
          : {}),
        ...(part.result_provider_metadata !== undefined
          ? { resultProviderMetadata: part.result_provider_metadata }
          : {}),
      };
    }
    if (part.state === "failed") {
      return {
        ...tool_identity_fields,
        toolCallId: part.tool_call_id,
        state: "output-error",
        input,
        ...(part.raw_input !== undefined ? { rawInput: part.raw_input } : {}),
        errorText: part.error || "Tool failed",
        ...call_provider_fields,
        ...(part.result_provider_metadata !== undefined
          ? { resultProviderMetadata: part.result_provider_metadata }
          : {}),
      };
    }
    return {
      ...tool_identity_fields,
      toolCallId: part.tool_call_id,
      state: part.state === "input-streaming" ? "input-streaming" : "input-available",
      ...(has_input ? { input } : {}),
      ...call_provider_fields,
    };
  }) as UIMessage["parts"];
}

function parse_json(input: string | undefined): unknown {
  const value = String(input || "").trim();
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
