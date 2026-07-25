/**
 * SDK Session 元数据辅助。
 *
 * 关键点（中文）
 * - 统一负责 `.downcity/agents/<agentId>/sessions/<sessionId>/messages/meta.json` 的规范化读取。
 * - 仅处理轻量配置摘要与索引信息，不负责消息 JSONL 的读写。
 */

import fs from "fs-extra";
import type { SessionHistoryMetaV1 } from "@/executor/types/SessionHistoryMeta.js";

function normalizeModelLabel(input: unknown): string | undefined {
  const label = typeof input === "string" ? input.trim() : "";
  return label || undefined;
}

/**
 * 归一化 session 标题。
 */
export function normalizeSessionTitle(input: unknown): string | undefined {
  const title = typeof input === "string" ? input.trim() : "";
  return title || undefined;
}

/**
 * 读取当前系统时区。
 */
export function resolveSystemTimezone(): string {
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
export async function readSessionMetadataFromPath(input: {
  /** meta.json 文件路径。 */
  filePath: string;
  /** 当前 sessionId。 */
  sessionId: string;
  /** 当前 agentId。 */
  agentId: string;
}): Promise<SessionHistoryMetaV1> {
  try {
    const raw = (await fs.readJson(input.filePath)) as Partial<SessionHistoryMetaV1>;
    return normalize_session_metadata(raw, input.sessionId, input.agentId);
  } catch {
    return normalize_session_metadata({}, input.sessionId, input.agentId);
  }
}

/** 将未知 Metadata 内容规范化为当前 Session 的稳定结构。 */
export function normalize_session_metadata(
  raw: Partial<SessionHistoryMetaV1>,
  session_id: string,
  agent_id: string,
): SessionHistoryMetaV1 {
  return {
    v: 1,
    sessionId: session_id,
    agentId: agent_id,
    createdAt:
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : Date.now(),
    timezone: normalizeTimezone(raw.timezone) || resolveSystemTimezone(),
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : 0,
    ...(normalizeSessionTitle(raw.title)
      ? { title: normalizeSessionTitle(raw.title) }
      : {}),
    ...(normalizeModelLabel(raw.modelLabel)
      ? { modelLabel: normalizeModelLabel(raw.modelLabel) }
      : {}),
    ...(normalize_message_count(raw.messageCount) !== undefined
      ? { messageCount: normalize_message_count(raw.messageCount) }
      : {}),
    ...(normalize_preview_text(raw.previewText)
      ? { previewText: normalize_preview_text(raw.previewText) }
      : {}),
    ...(normalize_history_bytes(raw.historyBytes) !== undefined
      ? { historyBytes: normalize_history_bytes(raw.historyBytes) }
      : {}),
  };
}
