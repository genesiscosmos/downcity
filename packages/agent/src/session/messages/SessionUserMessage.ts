/**
 * Session User Message 与公开输入 Part 的 canonical 转换规则。
 *
 * 本模块只做内容归一化：把调用方提供的内容转成确定、可持久化的形状，
 * 不分配 `part_id` 与 `sequence`——identity 属于拥有该消息的一方。
 */

import type {
  SessionAgentContent,
  SessionUserContent,
  SessionUserPartContent,
} from "@downcity/type";
import { to_session_json_value } from "@/session/messages/SessionJsonValue.js";
import {
  normalize_session_context_content,
  normalize_session_context_tag,
} from "@/session/messages/SessionUserContext.js";

/** 把 Downcity Session User 输入归一为尚未分配身份的内容 Part。 */
export function normalize_session_user_parts(
  parts: SessionUserContent[] | null | undefined,
): SessionUserPartContent[] {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap<SessionUserPartContent>((part) => {
    if (part.type === "text") {
      return [{ type: "text", text: part.text }];
    }
    if (part.type === "context") {
      return [{
        type: "context",
        tag: normalize_session_context_tag(part.tag),
        context: normalize_session_context_content(part.context),
      }];
    }
    if (part.type === "file") {
      return [{
        type: "file",
        url: part.url,
        media_type: part.media_type,
        ...(part.filename ? { filename: part.filename } : {}),
      }];
    }
    return [{
      type: "data",
      data_type: part.data_type,
      data: to_session_json_value(part.data),
      ...(part.data_id ? { data_id: part.data_id } : {}),
    }];
  });
}

/** 判断 Assistant 结果中是否包含可持久化内容。 */
export function has_assistant_result_content(
  parts: readonly SessionAgentContent[],
): boolean {
  return parts.some((part) => {
    if (part.type === "text") return Boolean(part.text.trim());
    if (part.type === "file") {
      return Boolean(part.media_type.trim() && part.url.trim());
    }
    return Boolean(part.data_type.trim());
  });
}
