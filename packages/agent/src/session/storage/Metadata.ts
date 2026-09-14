/**
 * SDK Session 元数据辅助。
 *
 * 关键点（中文）
 * - 统一负责 Session SQLite 中轻量配置摘要与索引字段的规范化。
 * - 不负责数据库连接、消息聚合或附件读写。
 */

import type { SessionHistoryMeta } from "@/executor/types/SessionHistoryMeta.js";
import type { SessionOrigin } from "@downcity/type";
import { restore_session_origin } from "@downcity/type";

function normalizeModelLabel(input: unknown): string | undefined {
  const label = typeof input === "string" ? input.trim() : "";
  return label || undefined;
}

/** 归一化 Session Shell 审批模式。 */
function normalize_approval_mode(
  input: unknown,
): "ask" | "always-allow" | undefined {
  return input === "ask" || input === "always-allow" ? input : undefined;
}

/**
 * 归一化 session 标题。
 */
export function normalize_session_title(input: unknown): string | undefined {
  const title = typeof input === "string" ? input.trim() : "";
  return title || undefined;
}

/**
 * 读取当前系统时区。
 */
export function resolve_system_timezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof timezone === "string" && timezone.trim()
    ? timezone.trim()
    : "UTC";
}

function normalizeTimezone(input: unknown): string | undefined {
  const timezone = typeof input === "string" ? input.trim() : "";
  return timezone || undefined;
}

function normalize_message_count(input: unknown): number | undefined {
  return typeof input === "number" && Number.isInteger(input) && input >= 0
    ? input
    : undefined;
}

function normalize_preview_text(input: unknown): string | undefined {
  const preview_text = typeof input === "string" ? input.trim() : "";
  return preview_text || undefined;
}

/** 将未知 Metadata 内容规范化为当前 Session 的稳定结构。 */
export function normalize_session_metadata(
  raw: Partial<SessionHistoryMeta>,
  session_id: string,
  agent_id: string,
  origin: SessionOrigin,
  workspace_id?: string,
): SessionHistoryMeta {
  return {
    v: 2,
    session_id: session_id,
    agent_id: agent_id,
    ...(workspace_id ? { workspace_id: workspace_id } : {}),
    origin: restore_session_origin(raw.origin ?? origin, origin.type),
    created_at:
      typeof raw.created_at === "number" && Number.isFinite(raw.created_at)
        ? raw.created_at
        : Date.now(),
    timezone: normalizeTimezone(raw.timezone) || resolve_system_timezone(),
    updated_at:
      typeof raw.updated_at === "number" && Number.isFinite(raw.updated_at)
        ? raw.updated_at
        : 0,
    ...(normalize_session_title(raw.title)
      ? { title: normalize_session_title(raw.title) }
      : {}),
    ...(normalizeModelLabel(raw.model_label)
      ? { model_label: normalizeModelLabel(raw.model_label) }
      : {}),
    ...(normalize_approval_mode(raw.approval_mode)
      ? { approval_mode: normalize_approval_mode(raw.approval_mode) }
      : {}),
    ...(normalize_message_count(raw.message_count) !== undefined
      ? { message_count: normalize_message_count(raw.message_count) }
      : {}),
    ...(normalize_preview_text(raw.preview_text)
      ? { preview_text: normalize_preview_text(raw.preview_text) }
      : {}),
  };
}
