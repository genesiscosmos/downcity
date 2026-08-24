/**
 * Workspace 本地运行数据与 Session 路径规则。
 *
 * 关键点（中文）
 * - 调用方已经把文件能力限制在当前 Agent 的私有数据根。
 * - Session 在 Agent 内使用稳定且唯一的 session_id 定位。
 * - 本模块只拼接作用域内的相对领域路径，不解析用户级数据根。
 */

import path from "node:path";

/** 返回活动 Session 集合目录。 */
export function get_workspace_sessions_path(storage_root_path: string): string {
  return path.join(path.resolve(storage_root_path), "sessions");
}

/** 返回归档 Session 集合目录。 */
export function get_workspace_archived_sessions_path(
  storage_root_path: string,
): string {
  return path.join(path.resolve(storage_root_path), "archived-sessions");
}

/** 返回单个活动 Session 目录。 */
export function get_workspace_session_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_sessions_path(storage_root_path),
    encodeURIComponent(String(session_id || "").trim()),
  );
}

/** 返回单个归档 Session 目录。 */
export function get_workspace_archived_session_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_archived_sessions_path(storage_root_path),
    encodeURIComponent(String(session_id || "").trim()),
  );
}

/** 返回单个 Session 的 instruction.md 路径。 */
export function get_workspace_session_instruction_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_session_path(storage_root_path, session_id),
    "instruction.md",
  );
}

/** 返回单个 Session 的附件目录。 */
export function get_workspace_session_attachments_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_session_path(storage_root_path, session_id),
    "attachments",
  );
}

/** 返回单个 Session 的消息目录。 */
export function get_workspace_session_messages_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_session_path(storage_root_path, session_id),
    "messages",
  );
}

/** 返回单个 Session 的 Active JSONL 路径。 */
export function get_workspace_session_active_messages_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_session_messages_path(storage_root_path, session_id),
    "active.jsonl",
  );
}

/** 返回单个 Session 的运行中 Assistant 快照路径。 */
export function get_workspace_session_assistant_message_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_session_messages_path(storage_root_path, session_id),
    "assistant_message.json",
  );
}

/** 返回单个 Session 的 meta.json 路径。 */
export function get_workspace_session_meta_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_session_path(storage_root_path, session_id),
    "meta.json",
  );
}

/** 返回单个归档 Session 的消息目录。 */
export function get_workspace_archived_session_messages_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_archived_session_path(storage_root_path, session_id),
    "messages",
  );
}

/** 返回单个归档 Session 的 Active JSONL 路径。 */
export function get_workspace_archived_session_active_messages_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_archived_session_messages_path(storage_root_path, session_id),
    "active.jsonl",
  );
}

/** 返回单个归档 Session 的 meta.json 路径。 */
export function get_workspace_archived_session_meta_path(
  storage_root_path: string,
  session_id: string,
): string {
  return path.join(
    get_workspace_archived_session_path(storage_root_path, session_id),
    "meta.json",
  );
}
