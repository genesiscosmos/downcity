/**
 * Workspace LocalAgentStore 的 Session 路径规则。
 *
 * 关键点（中文）
 * - 所有 agent session 统一落盘到 `.downcity/agents/<agent_id>/sessions/<session_id>/...`。
 * - `agent_id` 是唯一隔离维度，不再保留第二套旧 session 根目录。
 */

import path from "node:path";

/**
 * `.downcity` 根目录路径。
 */
export function get_sdk_downcity_dir_path(workspace_path: string): string {
  return path.join(workspace_path, ".downcity");
}

/**
 * SDK agents 根目录路径。
 */
export function get_sdk_agents_root_dir_path(workspace_path: string): string {
  return path.join(get_sdk_downcity_dir_path(workspace_path), "agents");
}

/**
 * 单个 agent 根目录路径。
 */
export function get_sdk_agent_dir_path(
  workspace_path: string,
  agent_id: string,
): string {
  return path.join(
    get_sdk_agents_root_dir_path(workspace_path),
    encodeURIComponent(String(agent_id || "").trim()),
  );
}

/**
 * 单个 agent 的 sessions 根目录路径。
 */
export function get_sdk_agent_sessions_root_dir_path(
  workspace_path: string,
  agent_id: string,
): string {
  return path.join(get_sdk_agent_dir_path(workspace_path, agent_id), "sessions");
}

/**
 * 单个 agent 的已归档 sessions 根目录路径。
 *
 * 关键点（中文）
 * - `archive_session` 会把整个 session 目录从 `sessions/<session_id>` 移动到此处。
 * - `clean_archive` 会永久删除该目录下的全部内容。
 */
export function get_sdk_agent_archived_sessions_dir_path(
  workspace_path: string,
  agent_id: string,
): string {
  return path.join(get_sdk_agent_dir_path(workspace_path, agent_id), "archived-sessions");
}

/**
 * 单个已归档 session 的根目录路径。
 */
export function get_sdk_agent_archived_session_dir_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_archived_sessions_dir_path(workspace_path, agent_id),
    encodeURIComponent(String(session_id || "").trim()),
  );
}

/**
 * 单个已归档 session 的消息目录路径。
 */
export function get_sdk_agent_archived_session_messages_dir_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_archived_session_dir_path(workspace_path, agent_id, session_id),
    "messages",
  );
}

/**
 * 单个已归档 session 的 Active JSONL 文件路径。
 */
export function get_sdk_agent_archived_session_messages_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_archived_session_messages_dir_path(workspace_path, agent_id, session_id),
    "active.jsonl",
  );
}

/**
 * 单个已归档 session 的 meta.json 路径。
 */
export function get_sdk_agent_archived_session_meta_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_archived_session_messages_dir_path(workspace_path, agent_id, session_id),
    "meta.json",
  );
}

/**
 * 单个 session 根目录路径。
 */
export function get_sdk_agent_session_dir_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_sessions_root_dir_path(workspace_path, agent_id),
    encodeURIComponent(String(session_id || "").trim()),
  );
}

/**
 * 单个 session 显式固化完整 system 的 instruction.md 路径。
 *
 * 关键点（中文）
 * - 文件不存在表示 Session 恢复时继续采用 Agent 当前 instruction。
 * - 空文件表示调用方显式固化了空 system。
 */
export function get_sdk_agent_session_instruction_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_session_dir_path(workspace_path, agent_id, session_id),
    "instruction.md",
  );
}

/**
 * 单个 session 的消息目录路径。
 */
export function get_sdk_agent_session_messages_dir_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_session_dir_path(workspace_path, agent_id, session_id),
    "messages",
  );
}

/**
 * 单个 session 的 Active JSONL 文件路径。
 */
export function get_sdk_agent_session_messages_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_session_messages_dir_path(workspace_path, agent_id, session_id),
    "active.jsonl",
  );
}

/**
 * 单个 session 的 meta.json 路径。
 */
export function get_sdk_agent_session_meta_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_session_messages_dir_path(workspace_path, agent_id, session_id),
    "meta.json",
  );
}

/**
 * 单个 session 的 inflight assistant 路径。
 *
 * 关键点（中文）
 * - 运行中的 assistant 只保留一份增量快照。
 * - step / tool 过程会持续重写这个文件，避免中途中断后过程完全丢失。
 * - 完成后再把最终 assistant 合并进 `active.jsonl`，并清理该文件。
 */
export function get_sdk_agent_session_assistant_message_path(
  workspace_path: string,
  agent_id: string,
  session_id: string,
): string {
  return path.join(
    get_sdk_agent_session_messages_dir_path(workspace_path, agent_id, session_id),
    "assistant_message.json",
  );
}
