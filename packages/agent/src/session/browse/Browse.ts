/**
 * SDK Session 浏览辅助。
 *
 * 关键点（中文）
 * - 统一负责 session 列表摘要、session 详情与 history 分页的投影逻辑。
 * - session title 允许为空；浏览层不会再从首条 user message 推导 fallback title。
 * - 面向 SDK / RemoteAgent / downcity gateway route 复用，避免在多个入口重复拼列表与分页语义。
 * - 这里不持有运行态状态；执行状态等动态信息通过调用参数显式注入。
 */

import path from "node:path";
import type {
  AgentListSessionsInput,
  AgentSessionInfo,
  AgentSessionSummary,
  AgentSessionSummaryPage,
} from "@/types/agent/SessionTypes.js";
import type {
  SessionRecordV1,
  SessionMetadataV1,
} from "@/executor/types/SessionRecords.js";
import { is_session_message_record } from "@/executor/types/SessionRecords.js";
import type { SessionHistoryMetaV1 } from "@/executor/types/SessionHistoryMeta.js";
import { resolve_session_message_preview } from "@/session/preview/SessionMessagePreview.js";
import {
  get_workspace_archived_session_active_messages_path,
  get_workspace_archived_session_meta_path,
  get_workspace_archived_sessions_path,
  get_workspace_session_active_messages_path,
  get_workspace_session_meta_path,
  get_workspace_sessions_path,
} from "@/workspace/store/LocalStorePaths.js";
import { read_session_metadata_from_path } from "@/session/storage/Metadata.js";
import { to_executor_ui_message } from "@/session/messages/SessionMessageCodec.js";
import type { SessionMessage } from "@/types/session/SessionMessage.js";
import type { FileSystem } from "@downcity/workspace";

type SessionBrowseBaseInput = {
  /**
   * 当前项目根目录。
   */
  project_root: string;

  /**
   * 当前 agent_id。
   */
  agent_id: string;

  /**
   * 当前 session_id。
   */
  session_id: string;

  /**
   * 当前 session 已读取到的 metadata。
   */
  metadata: SessionHistoryMetaV1;

  /**
   * 当前 session 已读取到的完整消息。
   *
   * 说明（中文）：列表查询已有 metadata 摘要时可省略，详情查询仍传完整记录。
   */
  messages?: SessionRecordV1[];

  /**
   * 当前 session 是否正在执行。
   */
  executing?: boolean;
};

function decodeMaybe(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function normalizeLimit(input: unknown, fallback: number, max: number): number {
  const value =
    typeof input === "number" && Number.isFinite(input)
      ? input
      : typeof input === "string" && input.trim()
        ? Number(input)
        : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function truncateText(input: string, maxChars: number): string {
  const value = String(input || "").trim();
  if (!value) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeCursor(input: unknown): number {
  const raw = String(input || "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function encodeCursor(offset: number): string | undefined {
  if (!Number.isFinite(offset) || offset <= 0) return undefined;
  return String(Math.floor(offset));
}

/**
 * 读取指定 JSONL 消息文件。
 */
export async function load_session_messages_from_path(
  filePath: string,
  files: FileSystem,
): Promise<SessionRecordV1[]> {
  const messages_by_id = new Map<string, SessionMessage>();
  if (await files.path_exists(filePath)) {
    const raw = (await files.read_file(filePath)).toString("utf8");
    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const message = JSON.parse(line) as SessionMessage;
        if (!is_canonical_session_message(message)) continue;
        const previous = messages_by_id.get(message.message_id);
        if (!previous || message.revision > previous.revision) {
          messages_by_id.set(message.message_id, message);
        }
      } catch {
        // 关键点（中文）：单行损坏不影响整个 session 的可读性。
      }
    }
  }

  const inflight_path = path.join(path.dirname(filePath), "assistant_message.json");
  if (await files.path_exists(inflight_path)) {
    try {
      const message = JSON.parse(
        (await files.read_file(inflight_path)).toString("utf8"),
      ) as SessionMessage;
      if (is_canonical_session_message(message) && message.type === "assistant") {
        messages_by_id.set(message.message_id, message);
      }
    } catch {
      // 运行中快照损坏时仍返回已经完成的历史。
    }
  }

  return [...messages_by_id.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .flatMap(project_canonical_message_record);
}

function is_canonical_session_message(input: unknown): input is SessionMessage {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Partial<SessionMessage>;
  return (
    typeof candidate.message_id === "string" &&
    typeof candidate.session_id === "string" &&
    typeof candidate.sequence === "number" &&
    typeof candidate.revision === "number" &&
    (candidate.type === "user" ||
      candidate.type === "assistant" ||
      candidate.type === "action" ||
      candidate.type === "error")
  );
}

function project_canonical_message_record(message: SessionMessage): SessionRecordV1[] {
  const projected = to_executor_ui_message(message);
  if (projected) return [projected];
  if (message.type !== "action") return [];
  return [{
    type: "action",
    id: message.message_id,
    title: message.title,
    ...(message.description ? { description: message.description } : {}),
    state: message.status,
    metadata: {
      v: 1,
      ts: message.updated_at,
      session_id: message.session_id,
      ...(message.turn_id ? { turn_id: message.turn_id } : {}),
    },
  }];
}

function isCompactSummaryMessage(message: SessionRecordV1): boolean {
  if (!is_session_message_record(message)) return false;
  const metadata = (message.metadata || null) as SessionMetadataV1 | null;
  return metadata?.source === "compact" || metadata?.kind === "summary";
}

function filterUserVisibleHistoryMessages(
  messages: SessionRecordV1[],
): SessionRecordV1[] {
  return messages.filter((message) => !isCompactSummaryMessage(message));
}

/**
 * 基于 metadata + messages 构建 SDK session 详情。
 */
export function build_session_info(
  input: SessionBrowseBaseInput,
): AgentSessionInfo {
  const messages = input.messages;
  const preview_text = messages && messages.length > 0
    ? truncateText(
        resolve_session_message_preview(messages[messages.length - 1]),
        180,
      )
    : input.metadata.preview_text;
  const message_count = typeof input.metadata.message_count === "number"
    ? input.metadata.message_count
    : messages
      ? filterUserVisibleHistoryMessages(messages).length
      : 0;
  const title =
    typeof input.metadata.title === "string" && input.metadata.title.trim()
      ? input.metadata.title.trim()
      : undefined;
  return {
    agent_id: input.agent_id,
    session_id: input.session_id,
    ...(title ? { title } : {}),
    ...(preview_text ? { preview_text } : {}),
    message_count: message_count,
    ...(typeof input.metadata.created_at === "number"
      ? { created_at: input.metadata.created_at }
      : {}),
    ...(typeof input.metadata.updated_at === "number"
      ? { updated_at: input.metadata.updated_at }
      : {}),
    ...(input.metadata.model_label
      ? { model_label: input.metadata.model_label }
      : {}),
    ...(typeof input.metadata.timezone === "string" && input.metadata.timezone.trim()
      ? { timezone: input.metadata.timezone.trim() }
      : {}),
    ...(input.executing ? { executing: true } : {}),
  };
}

/**
 * 读取列表所需的轻量 session 摘要。
 *
 * 关键点（中文）
 * - 新记录直接使用 metadata 摘要，不扫描 active.jsonl。
 * - 旧记录或执行中记录回退读取一次完整历史，并把摘要补写回 metadata。
 */
async function resolve_session_summary_metadata(input: {
  /** 当前 session metadata。 */
  metadata: SessionHistoryMetaV1;
  /** 当前消息 JSONL 路径。 */
  messagesPath: string;
  /** 当前 metadata 路径。 */
  metaPath: string;
  /** 是否强制刷新摘要。 */
  refresh: boolean;
  /** 当前 Workspace 的统一文件能力。 */
  files: FileSystem;
}): Promise<SessionHistoryMetaV1> {
  const storage_stats = await resolve_session_disk_stats(
    input.messagesPath,
    input.files,
  );
  const history_bytes = storage_stats.history_bytes;
  const inflight_path = path.join(path.dirname(input.messagesPath), "assistant_message.json");
  const has_inflight = await input.files.path_exists(inflight_path);
  if (
    !input.refresh &&
    !has_inflight &&
    typeof input.metadata.message_count === "number" &&
    input.metadata.historyBytes === history_bytes
  ) {
    return input.metadata;
  }
  const messages = await load_session_messages_from_path(
    input.messagesPath,
    input.files,
  );
  const last_message = messages[messages.length - 1];
  const preview_text = last_message
    ? truncateText(resolve_session_message_preview(last_message), 180)
    : "";
  const { preview_text: _previous_preview, ...metadata_without_preview } = input.metadata;
  void _previous_preview;
  const next_metadata: SessionHistoryMetaV1 = {
    ...metadata_without_preview,
    message_count: storage_stats.message_count,
    historyBytes: history_bytes,
    ...(preview_text || input.metadata.preview_text
      ? { preview_text: preview_text || input.metadata.preview_text }
      : {}),
  };
  await input.files.write_file_atomically(
    input.metaPath,
    `${JSON.stringify(next_metadata, null, 2)}\n`,
  );
  return next_metadata;
}

/**
 * 只读取 Active 和 Segment 文件索引，计算列表所需的持久化统计。
 *
 * 关键点（中文）
 * - Segment 的结束 sequence 直接来自文件名，不解析历史正文。
 * - Active 需要逐行读取，以同时覆盖 revision 行与运行中 Assistant sequence。
 */
async function resolve_session_disk_stats(
  messages_path: string,
  files: FileSystem,
) {
  const messages_dir_path = path.dirname(messages_path);
  const segments_dir_path = path.join(messages_dir_path, "segments");
  const segment_entries = await files.read_directory(segments_dir_path)
    .catch(() => []);
  const segment_files = segment_entries.flatMap((entry) => {
    if (!entry.is_file) return [];
    const match = /^(\d+)-(\d+)\.jsonl$/.exec(entry.name);
    if (!match) return [];
    return [{
      file_path: path.join(segments_dir_path, entry.name),
      end_sequence: Number(match[2]),
    }];
  });
  const active_raw = await files.read_file(messages_path)
    .then((value) => value.toString("utf8"))
    .catch(() => "");
  let latest_active_sequence = 0;
  for (const line of active_raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line) as Partial<SessionMessage>;
      if (Number.isInteger(message.sequence)) {
        latest_active_sequence = Math.max(latest_active_sequence, Number(message.sequence));
      }
    } catch {
      // 单行损坏不阻断 Session 列表，其正文读取时会按既有规则忽略。
    }
  }
  const inflight_path = path.join(messages_dir_path, "assistant_message.json");
  try {
    const inflight = JSON.parse(
      (await files.read_file(inflight_path)).toString("utf8"),
    ) as Partial<SessionMessage>;
    if (Number.isInteger(inflight.sequence)) {
      latest_active_sequence = Math.max(latest_active_sequence, Number(inflight.sequence));
    }
  } catch {
    // 草稿不存在或损坏时只统计已完成历史。
  }
  const segment_sizes = await Promise.all(
    segment_files.map(({ file_path }) => files.file_size(file_path)
      .catch(() => 0)),
  );
  const latest_segment_sequence = segment_files.reduce(
    (latest, segment) => Math.max(latest, segment.end_sequence),
    0,
  );
  return {
    history_bytes: Buffer.byteLength(active_raw, "utf8") +
      segment_sizes.reduce((total, size) => total + size, 0),
    message_count: Math.max(latest_segment_sequence, latest_active_sequence),
  };
}

/**
 * 列出指定 agent 的 session 摘要页。
 */
export async function list_agent_session_summary_page(params: {
  project_root: string;
  agent_id: string;
  workspace_id?: string;
  input?: AgentListSessionsInput;
  executingSessionIds?: Set<string>;
  files: FileSystem;
}): Promise<AgentSessionSummaryPage> {
  const limit = normalizeLimit(params.input?.limit, 50, 500);
  const cursor = normalizeCursor(params.input?.cursor);
  const query = String(params.input?.query || "").trim().toLowerCase();
  const sessionsRoot = get_workspace_sessions_path(params.project_root);

  if (!(await params.files.path_exists(sessionsRoot))) {
    return {
      items: [],
      total: 0,
      has_more: false,
    };
  }

  const entries = await params.files.read_directory(sessionsRoot);
  const summaries: AgentSessionSummary[] = [];

  for (const entry of entries) {
    if (!entry.is_directory) continue;
    const session_id = decodeMaybe(entry.name);
    if (!session_id) continue;
    const meta_path = get_workspace_session_meta_path(
      params.project_root,
      session_id,
    );
    const messages_path = get_workspace_session_active_messages_path(
      params.project_root,
      session_id,
    );
    const persisted_metadata = await read_session_metadata_from_path({
      filePath: meta_path,
      session_id,
      agent_id: params.agent_id,
      workspace_id: params.workspace_id,
      files: params.files,
    }).catch(() => null);
    if (!persisted_metadata) continue;
    const metadata = await resolve_session_summary_metadata({
      metadata: persisted_metadata,
      messagesPath: messages_path,
      metaPath: meta_path,
      refresh: params.executingSessionIds?.has(session_id) === true,
      files: params.files,
    });
    const info = build_session_info({
      project_root: params.project_root,
      agent_id: params.agent_id,
      session_id,
      metadata,
      executing: params.executingSessionIds?.has(session_id),
    });
    const summary: AgentSessionSummary = {
      agent_id: info.agent_id,
      session_id: info.session_id,
      ...(info.title ? { title: info.title } : {}),
      ...(info.preview_text ? { preview_text: info.preview_text } : {}),
      message_count: info.message_count,
      ...(typeof info.created_at === "number" ? { created_at: info.created_at } : {}),
      ...(typeof info.updated_at === "number" ? { updated_at: info.updated_at } : {}),
      ...(info.model_label ? { model_label: info.model_label } : {}),
      ...(info.executing ? { executing: true } : {}),
    };

    if (query) {
      const haystack = [
        summary.session_id,
        summary.title || "",
        summary.preview_text || "",
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(query)) continue;
    }

    summaries.push(summary);
  }

  summaries.sort((left, right) => (right.updated_at || 0) - (left.updated_at || 0));

  const items = summaries.slice(cursor, cursor + limit);
  const nextOffset = cursor + items.length;
  return {
    items,
    total: summaries.length,
    ...(nextOffset < summaries.length
      ? { next_cursor: encodeCursor(nextOffset) }
      : {}),
    has_more: nextOffset < summaries.length,
  };
}

/**
 * 列出指定 agent 的已归档 session 摘要页。
 */
export async function list_archived_agent_session_summary_page(params: {
  project_root: string;
  agent_id: string;
  workspace_id?: string;
  input?: AgentListSessionsInput;
  files: FileSystem;
}): Promise<AgentSessionSummaryPage> {
  const limit = normalizeLimit(params.input?.limit, 50, 500);
  const cursor = normalizeCursor(params.input?.cursor);
  const query = String(params.input?.query || "").trim().toLowerCase();
  const archivedRoot = get_workspace_archived_sessions_path(params.project_root);

  if (!(await params.files.path_exists(archivedRoot))) {
    return {
      items: [],
      total: 0,
      has_more: false,
    };
  }

  const entries = await params.files.read_directory(archivedRoot);
  const summaries: AgentSessionSummary[] = [];

  for (const entry of entries) {
    if (!entry.is_directory) continue;
    const session_id = decodeMaybe(entry.name);
    if (!session_id) continue;
    const meta_path = get_workspace_archived_session_meta_path(
      params.project_root,
      session_id,
    );
    const messages_path = get_workspace_archived_session_active_messages_path(
      params.project_root,
      session_id,
    );
    const persisted_metadata = await read_session_metadata_from_path({
      filePath: meta_path,
      session_id,
      agent_id: params.agent_id,
      workspace_id: params.workspace_id,
      files: params.files,
    }).catch(() => null);
    if (!persisted_metadata) continue;
    const metadata = await resolve_session_summary_metadata({
      metadata: persisted_metadata,
      messagesPath: messages_path,
      metaPath: meta_path,
      refresh: false,
      files: params.files,
    });
    // 关键点（中文）：归档 session 不再生成新 title，仅读取归档目录内已有 meta。
    const info = build_session_info({
      project_root: params.project_root,
      agent_id: params.agent_id,
      session_id,
      metadata,
      executing: false,
    });
    const summary: AgentSessionSummary = {
      agent_id: info.agent_id,
      session_id: info.session_id,
      ...(info.title ? { title: info.title } : {}),
      ...(info.preview_text ? { preview_text: info.preview_text } : {}),
      message_count: info.message_count,
      ...(typeof info.created_at === "number" ? { created_at: info.created_at } : {}),
      ...(typeof info.updated_at === "number" ? { updated_at: info.updated_at } : {}),
      ...(info.model_label ? { model_label: info.model_label } : {}),
    };

    if (query) {
      const haystack = [
        summary.session_id,
        summary.title || "",
        summary.preview_text || "",
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(query)) continue;
    }

    summaries.push(summary);
  }

  summaries.sort((left, right) => (right.updated_at || 0) - (left.updated_at || 0));

  const items = summaries.slice(cursor, cursor + limit);
  const nextOffset = cursor + items.length;
  return {
    items,
    total: summaries.length,
    ...(nextOffset < summaries.length
      ? { next_cursor: encodeCursor(nextOffset) }
      : {}),
    has_more: nextOffset < summaries.length,
  };
}
