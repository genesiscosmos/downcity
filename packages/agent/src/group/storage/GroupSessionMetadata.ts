/**
 * GroupSession metadata v2 的持久化边界。
 *
 * 读取和写入共用同一校验：版本、历史身份及必需字段必须由记录本身提供，
 * 不从当前 Group、目录或系统时间补造。消息摘要的崩溃恢复由 DataStore 单独处理。
 */

import type { GroupSessionHistoryMeta } from "@/types/group/GroupSessionStore.js";

/** 校验当前格式及精确归属；保留有效字段原值和未由本模块解释的扩展字段。 */
export function assert_group_session_metadata(
  value: unknown,
  session_id: string,
  group_id: string,
): asserts value is GroupSessionHistoryMeta {
  if (!is_record(value)) throw new Error("Invalid GroupSession metadata object");
  if (value.v === 1) throw new Error("group_session_migration_required");
  if (value.v !== 2) {
    throw new Error(`Unsupported GroupSession metadata version: ${String(value.v)}`);
  }
  if (!is_identifier(value.session_id) || value.session_id !== session_id) {
    throw new Error(`Invalid GroupSession ownership metadata: ${session_id}`);
  }
  if (!is_identifier(value.group_id) || value.group_id !== group_id) {
    throw new Error(`GroupSession "${session_id}" has invalid Group ownership`);
  }
  for (const field of ["created_at", "updated_at"] as const) {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] < 0) {
      throw new Error(`Invalid GroupSession metadata ${field}: ${session_id}`);
    }
  }
  if (!Number.isSafeInteger(value.message_count) || (value.message_count as number) < 0) {
    throw new Error(`Invalid GroupSession metadata message_count: ${session_id}`);
  }
  if (value.workspace_id !== undefined && !is_identifier(value.workspace_id)) {
    throw new Error(`Invalid GroupSession metadata workspace_id: ${session_id}`);
  }
  for (const field of ["title", "preview_text"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(`Invalid GroupSession metadata ${field}: ${session_id}`);
    }
  }
  if (value.member_session_ids !== undefined) {
    if (!is_record(value.member_session_ids)
      || Object.entries(value.member_session_ids).some(([agent_id, member_id]) => (
        !is_identifier(agent_id) || !is_identifier(member_id)
      ))) {
      throw new Error(`Invalid GroupSession metadata member_session_ids: ${session_id}`);
    }
  }
  if (value.pending_message_ids !== undefined
    && (!Array.isArray(value.pending_message_ids) || value.pending_message_ids.some((id) => !is_identifier(id)))) {
    throw new Error(`Invalid GroupSession metadata pending_message_ids: ${session_id}`);
  }
}

/** JSON 对象不包含 null 或数组。 */
function is_record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 历史标识只检查有效性，不重写空白、大小写或永久身份。 */
function is_identifier(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}
