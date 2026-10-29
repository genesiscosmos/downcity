/**
 * Session 浏览投影。
 *
 * 本模块只从每个 Session 的 `session.db` 读取列表所需的轻量状态；Message 正文仍由
 * SessionStorage 聚合读取。浏览逻辑不创建 schema，也不尝试迁移旧文件格式。
 */

import { DatabaseSync } from "node:sqlite";
import type { AgentSessionInfo } from "@/types/agent/SessionTypes.js";
import type { SessionBrowseBaseInput, SessionBrowseStateRow } from "@/types/store/SessionBrowse.js";
import type { SessionHistoryMeta } from "@/types/store/SessionHistoryMeta.js";
import { resolve_session_message_preview } from "@/session/storage/SessionMessagePreview.js";
import { restore_session_origin } from "@downcity/type";

/** 裁剪用户可见预览。 */
function truncate_text(input: string, max_chars: number): string {
  const value = String(input || "").trim();
  if (value.length <= max_chars) return value;
  return `${value.slice(0, Math.max(0, max_chars - 1)).trimEnd()}…`;
}

/** 基于 metadata 与可选 Message 构建 SDK Session 详情。 */
export function build_session_info(input: SessionBrowseBaseInput): AgentSessionInfo {
  const latest_message = input.messages?.at(-1);
  const preview_text = latest_message
    ? truncate_text(resolve_session_message_preview(latest_message), 180)
    : input.metadata.preview_text;
  return {
    agent_id: input.agent_id,
    session_id: input.session_id,
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
    origin: input.metadata.origin,
    ...(input.metadata.workspace_id ? { workspace_id: input.metadata.workspace_id } : {}),
    ...(input.metadata.timezone ? { timezone: input.metadata.timezone } : {}),
    ...(input.executing ? { executing: true } : {}),
  };
}

/** 只读打开一个现有数据库并读取 Session 状态；失败时不改写磁盘。 */
export function read_session_metadata_from_database(
  database_path: string,
  fallback_category: string,
): SessionHistoryMeta | null {
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(database_path, { readOnly: true });
    const row = database.prepare(`
      SELECT session_id, agent_id, workspace_id, origin, timezone, title,
             model_label, approval_mode, message_count, preview_text,
             created_at, updated_at
      FROM session_state WHERE singleton_id = 1
    `).get() as unknown as SessionBrowseStateRow | undefined;
    if (!row) return null;
    return {
      v: 2,
      session_id: row.session_id,
      agent_id: row.agent_id,
      ...(row.workspace_id ? { workspace_id: row.workspace_id } : {}),
      origin: restore_session_origin(JSON.parse(row.origin), fallback_category),
      timezone: row.timezone,
      ...(row.title ? { title: row.title } : {}),
      ...(row.model_label ? { model_label: row.model_label } : {}),
      ...(row.approval_mode ? { approval_mode: row.approval_mode } : {}),
      message_count: row.message_count,
      ...(row.preview_text ? { preview_text: row.preview_text } : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

