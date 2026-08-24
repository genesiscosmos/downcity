/**
 * SDK Session 元数据辅助。
 *
 * 关键点（中文）
 * - 统一负责 Workspace `sessions/<session_id>/meta.json` 的规范化读取。
 * - 仅处理轻量配置摘要与索引信息，不负责消息 JSONL 的读写。
 */

import type { SessionHistoryMetaV1 } from "@/executor/types/SessionHistoryMeta.js";
import type { FileSystem } from "@downcity/workspace";

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

function normalize_history_bytes(input: unknown): number | undefined {
  return typeof input === "number" && Number.isInteger(input) && input >= 0
    ? input
    : undefined;
}

/**
 * 从指定路径读取 session meta.json。
 *
 * 关键点（中文）
 * - 供归档 session 等需要脱离默认 `sessions/` 目录的场景复用。
 * - 路径本身不做校验，调用方需保证可访问。
 */
export async function read_session_metadata_from_path(input: {
  /** meta.json 文件路径。 */
  filePath: string;
  /** 当前 session_id。 */
  session_id: string;
  /** 当前 agent_id。 */
  agent_id: string;
  /** 当前查询上下文的 workspace_id；仅用于兼容旧调用，不参与 Agent 归属校验。 */
  workspace_id?: string;
  /** 当前 Workspace 的统一文件能力。 */
  files: FileSystem;
}): Promise<SessionHistoryMetaV1> {
  const raw = JSON.parse(
    (await input.files.read_file(input.filePath)).toString("utf8"),
  ) as Partial<SessionHistoryMetaV1>;
  if (
    raw.session_id !== input.session_id ||
    raw.agent_id !== input.agent_id
  ) {
    throw new Error(`Invalid Session ownership metadata: ${input.session_id}`);
  }
  return normalize_session_metadata(
    raw,
    input.session_id,
    input.agent_id,
    raw.workspace_id || input.workspace_id,
  );
}

/** 将未知 Metadata 内容规范化为当前 Session 的稳定结构。 */
export function normalize_session_metadata(
  raw: Partial<SessionHistoryMetaV1>,
  session_id: string,
  agent_id: string,
  workspace_id?: string,
): SessionHistoryMetaV1 {
  return {
    v: 1,
    session_id: session_id,
    agent_id: agent_id,
    ...(workspace_id ? { workspace_id: workspace_id } : {}),
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
    ...(normalize_history_bytes(raw.historyBytes) !== undefined
      ? { historyBytes: normalize_history_bytes(raw.historyBytes) }
      : {}),
  };
}
