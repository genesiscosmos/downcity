/**
 * Session 详情的纯 metadata/preview 投影。
 * 输入由调用方读取；本模块不打开数据库，不依赖任何物理布局或历史 schema。
 */
import type { AgentSessionInfo } from "@/types/agent/SessionTypes.js";
import type { SessionInfoProjectionInput } from "@/types/store/SessionInfoProjection.js";
import { resolve_session_message_preview } from "./SessionMessagePreview.js";
import { normalize_session_descriptor } from "@downcity/type";

/** 裁剪用户可见预览。 */
function truncate_text(input: string, max_chars: number): string {
  const value = String(input || "").trim();
  if (value.length <= max_chars) return value;
  return `${value.slice(0, Math.max(0, max_chars - 1)).trimEnd()}…`;
}

/** 基于 metadata 与可选 Message 构建 SDK Session 详情。 */
export function build_session_info(input: SessionInfoProjectionInput): AgentSessionInfo {
  const latest_message = input.messages?.at(-1);
  const preview_text = latest_message
    ? truncate_text(resolve_session_message_preview(latest_message), 180)
    : input.metadata.preview_text;
  return {
    id: input.session_id,
    ...(input.metadata.title?.trim() ? { title: input.metadata.title.trim() } : {}),
    ...(preview_text ? { preview_text } : {}),
    message_count: input.metadata.message_count ?? input.messages?.length ?? 0,
    ...(typeof input.metadata.created_at === "number"
      ? { created_at: input.metadata.created_at }
      : {}),
    ...(typeof input.metadata.updated_at === "number"
      ? { updated_at: input.metadata.updated_at }
      : {}),
    ...(input.metadata.model_label ? { model_label: input.metadata.model_label } : {}),
    ...normalize_session_descriptor(input.metadata),
    ...(input.metadata.workspace_id ? { workspace_id: input.metadata.workspace_id } : {}),
    ...(input.metadata.timezone ? { timezone: input.metadata.timezone } : {}),
    ...(input.executing ? { executing: true } : {}),
  };
}
