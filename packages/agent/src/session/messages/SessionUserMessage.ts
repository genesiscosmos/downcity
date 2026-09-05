/**
 * Session User Message 与公开输入 Part 的 canonical 转换规则。
 *
 * 本模块只进行确定性数据归一化，不持有 Message、Store 或 Session 状态。
 */

import type {
  SessionAssistantResultPart,
  SessionPromptPart,
} from "@/types/session/SessionContent.js";
import type { SessionUserMessagePart } from "@/types/session/SessionMessage.js";
import { to_session_json_value } from "@/session/messages/SessionJsonValue.js";
import {
  normalize_session_context_content,
  normalize_session_context_tag,
} from "@/session/messages/SessionUserContext.js";

/** 把 Downcity Session User parts 归一为 canonical User parts。 */
export function normalize_session_user_parts(
  parts: SessionPromptPart[] | null | undefined,
): SessionUserMessagePart[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap<SessionUserMessagePart>((part, index) => {
    if (part.type === "text") {
      return [{
        part_id: `user-text:${index + 1}`,
        type: "text",
        text: part.text,
        state: "done",
      }];
    }
    if (part.type === "context") {
      return [{
        part_id: `user-context:${index + 1}`,
        type: "context",
        tag: normalize_session_context_tag(part.tag),
        context: normalize_session_context_content(part.context),
      }];
    }
    if (part.type === "file") {
      return [{
        part_id: `user-file:${index + 1}`,
        type: "file",
        url: part.url,
        media_type: part.media_type,
        ...(part.filename ? { filename: part.filename } : {}),
      }];
    }
    return [{
      part_id: `user-data:${index + 1}`,
      type: "data",
      data_type: part.data_type,
      data: to_session_json_value(part.data),
      ...(part.data_id ? { data_id: part.data_id } : {}),
    }];
  });
}

/** 校验直接写入的 canonical User Parts，并保留已有 Part identity。 */
export function normalize_canonical_session_user_parts(
  parts: readonly SessionUserMessagePart[],
): SessionUserMessagePart[] {
  return parts.map((part) => {
    const canonical = structuredClone(part);
    if (canonical.type !== "context") return canonical;
    return {
      ...canonical,
      tag: normalize_session_context_tag(canonical.tag),
      context: normalize_session_context_content(canonical.context),
    };
  });
}

/** 判断 Assistant 结果中是否包含可持久化内容。 */
export function has_assistant_result_content(
  parts: readonly SessionAssistantResultPart[],
): boolean {
  return parts.some((part) => {
    if (part.type === "text") return Boolean(part.text.trim());
    if (part.type === "file") {
      return Boolean(part.media_type.trim() && part.url.trim());
    }
    return Boolean(part.data_type.trim());
  });
}
