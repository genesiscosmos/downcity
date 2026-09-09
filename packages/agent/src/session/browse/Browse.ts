/**
 * Session 浏览投影。
 *
 * 本模块只从每个 Session 的 `session.db` 读取列表所需的轻量状态；Message 正文仍由
 * SessionStorage 聚合读取。浏览逻辑不创建 schema，也不尝试迁移旧文件格式。
 */

import { DatabaseSync } from "node:sqlite";
import type {
  AgentListSessionsInput,
  AgentSessionInfo,
  AgentSessionSummary,
  AgentSessionSummaryPage,
} from "@/types/agent/SessionTypes.js";
import type { SessionHistoryMeta } from "@/executor/types/SessionHistoryMeta.js";
import { resolve_session_message_preview } from "@/session/preview/SessionMessagePreview.js";
import {
  get_agent_archived_session_database_path,
  get_agent_archived_sessions_path,
  get_agent_session_database_path,
  get_agent_sessions_path,
} from "@/session/storage/LocalStorePaths.js";
import {
  normalize_session_origin_type,
  restore_session_origin,
  type FileSystem,
  type SessionMessage,
} from "@downcity/type";

/** SQLite 中列表投影所需的 session_state 行。 */
interface SessionBrowseStateRow {
  /** Session 标识。 */
  session_id: string;
  /** Agent 标识。 */
  agent_id: string;
  /** 可选 Workspace 标识。 */
  workspace_id: string | null;
  /** JSON 编码的来源。 */
  origin: string;
  /** Session 时区。 */
  timezone: string;
  /** 可选标题。 */
  title: string | null;
  /** 可选模型标签。 */
  model_label: string | null;
  /** 可选审批模式。 */
  approval_mode: "ask" | "always-allow" | null;
  /** canonical Message 数量。 */
  message_count: number;
  /** 最新消息预览。 */
  preview_text: string | null;
  /** 创建时间。 */
  created_at: number;
  /** 更新时间。 */
  updated_at: number;
}

/** Session 详情投影输入。 */
interface SessionBrowseBaseInput {
  /** 当前项目或私有存储根目录。 */
  project_root: string;
  /** 当前 Agent 标识。 */
  agent_id: string;
  /** 当前 Session 标识。 */
  session_id: string;
  /** 已读取的 Session 状态。 */
  metadata: SessionHistoryMeta;
  /** 可选完整 Message，用于即时生成详情预览。 */
  messages?: SessionMessage[];
  /** 当前 Session 是否正在执行。 */
  executing?: boolean;
}

/** 从目录名恢复 Session 标识。 */
function decode_session_id(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

/** 规范化分页上限。 */
function normalize_limit(input: unknown, fallback: number, max: number): number {
  const value = typeof input === "number" && Number.isFinite(input)
    ? input
    : typeof input === "string" && input.trim()
      ? Number(input)
      : NaN;
  return Number.isFinite(value)
    ? Math.max(1, Math.min(max, Math.floor(value)))
    : fallback;
}

/** 规范化透明 offset cursor。 */
function normalize_cursor(input: unknown): number {
  const value = Number(String(input || "").trim());
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

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
  fallback_origin_type: string,
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
      origin: restore_session_origin(JSON.parse(row.origin), fallback_origin_type),
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

/** 列出活动 Session 摘要页。 */
export async function list_agent_session_summary_page(input: {
  /** Agent 私有存储根目录。 */
  project_root: string;
  /** 当前 Agent 标识。 */
  agent_id: string;
  /** 可选 Workspace 过滤。 */
  workspace_id?: string;
  /** 列表查询。 */
  input?: AgentListSessionsInput;
  /** 当前执行中的 Session。 */
  executing_session_ids?: ReadonlySet<string>;
  /** Agent 私有文件能力。 */
  files: FileSystem;
}): Promise<AgentSessionSummaryPage> {
  return await list_session_summary_page({ ...input, archived: false });
}

/** 列出归档 Session 摘要页。 */
export async function list_archived_agent_session_summary_page(input: {
  /** Agent 私有存储根目录。 */
  project_root: string;
  /** 当前 Agent 标识。 */
  agent_id: string;
  /** 可选 Workspace 过滤。 */
  workspace_id?: string;
  /** 列表查询。 */
  input?: AgentListSessionsInput;
  /** Agent 私有文件能力。 */
  files: FileSystem;
}): Promise<AgentSessionSummaryPage> {
  return await list_session_summary_page({ ...input, archived: true });
}

/** 扫描单个来源分区中的 Session 数据库并建立轻量列表。 */
async function list_session_summary_page(input: {
  /** Agent 私有存储根目录。 */
  project_root: string;
  /** 当前 Agent 标识。 */
  agent_id: string;
  /** 可选 Workspace 过滤。 */
  workspace_id?: string;
  /** 列表查询。 */
  input?: AgentListSessionsInput;
  /** 当前执行中的 Session。 */
  executing_session_ids?: ReadonlySet<string>;
  /** Agent 私有文件能力。 */
  files: FileSystem;
  /** 是否扫描归档目录。 */
  archived: boolean;
}): Promise<AgentSessionSummaryPage> {
  const origin_type = normalize_session_origin_type(input.input?.origin_type ?? "chat");
  const sessions_path = input.archived
    ? get_agent_archived_sessions_path(input.project_root, origin_type)
    : get_agent_sessions_path(input.project_root, origin_type);
  if (!(await input.files.path_exists(sessions_path))) {
    return { items: [], total: 0, has_more: false };
  }
  const query = String(input.input?.query || "").trim().toLowerCase();
  const summaries: AgentSessionSummary[] = [];
  for (const entry of await input.files.read_directory(sessions_path)) {
    if (!entry.is_directory) continue;
    const session_id = decode_session_id(entry.name);
    const database_path = input.archived
      ? get_agent_archived_session_database_path(input.project_root, origin_type, session_id)
      : get_agent_session_database_path(input.project_root, origin_type, session_id);
    if (!(await input.files.path_exists(database_path))) continue;
    const metadata = read_session_metadata_from_database(database_path, origin_type);
    if (
      !metadata ||
      metadata.agent_id !== input.agent_id ||
      metadata.origin.type !== origin_type ||
      (input.workspace_id && metadata.workspace_id !== input.workspace_id)
    ) continue;
    const summary = build_session_info({
      project_root: input.project_root,
      agent_id: input.agent_id,
      session_id,
      metadata,
      executing: !input.archived && input.executing_session_ids?.has(session_id) === true,
    });
    if (query && ![
      summary.session_id,
      summary.title || "",
      summary.preview_text || "",
    ].join("\n").toLowerCase().includes(query)) continue;
    summaries.push(summary);
  }
  summaries.sort((left, right) => (right.updated_at || 0) - (left.updated_at || 0));
  const cursor = normalize_cursor(input.input?.cursor);
  const limit = normalize_limit(input.input?.limit, 50, 500);
  const items = summaries.slice(cursor, cursor + limit);
  const next_cursor = cursor + items.length;
  return {
    items,
    total: summaries.length,
    ...(next_cursor < summaries.length ? { next_cursor: String(next_cursor) } : {}),
    has_more: next_cursor < summaries.length,
  };
}
