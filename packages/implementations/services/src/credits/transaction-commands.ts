/**
 * Credits 原子账务命令构造器。
 *
 * 本模块只把已归一化的账务意图转换成 SQL 命令，不读取数据库、不执行业务
 * 决策。CreditsService 负责按固定顺序组合这些命令并通过 raw_atomic 原子提交。
 */

import {
  EPHEMERAL_CARD_TABLE,
  PRIMARY_CARD_TABLE,
  TRANSACTION_ENTRY_TABLE,
  TRANSACTION_TABLE,
} from "./schema.js";
import type { CreditsRawCommand } from "./types/RawDatabase.js";
import type {
  CreditsCardAllocation,
  CreditsTransactionRequest,
} from "./types/Runtime.js";
import {
  MAX_ACTIVE_EPHEMERAL_CARDS,
  MAX_USER_CREDITS,
  stable_stringify,
} from "./utils.js";

/** 构造待应用 Transaction 的幂等插入命令。 */
export function insert_transaction_command(
  transaction_id: string,
  request: CreditsTransactionRequest,
  now: string,
): CreditsRawCommand {
  return {
    sql: [
      `INSERT OR IGNORE INTO ${TRANSACTION_TABLE}`,
      "(transaction_id, kind, user_id, credits, status, idempotency_key, request_json, source, ref, note, metadata_json, created_at, applied_at)",
      "VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, '')",
    ].join(" "),
    params: [transaction_id, request.kind, request.user_id, request.credits, request.idempotency_key, request.request_json, request.source, request.ref, request.note, request.metadata_json, now],
  };
}

/** 构造单张 Card 的额度更新与事务标记命令。 */
export function update_card_command(
  transaction_id: string,
  kind: "primary" | "ephemeral",
  card_id: string,
  user_id: string,
  credits: number,
  operation: "topup" | "charge",
  now: string,
): CreditsRawCommand {
  const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
  const key = kind === "primary" ? "user_id" : "card_id";
  const delta = operation === "topup" ? credits : -credits;
  const sufficient = operation === "charge" ? "AND credits >= ?" : "";
  const unexpired = kind === "ephemeral" ? "AND expires_at > ?" : "";
  const within_card_limit = operation === "topup" && kind === "ephemeral"
    ? `AND (credits > 0 OR (SELECT COUNT(*) FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ? AND expires_at > ? AND credits > 0) < ?)`
    : "";
  const within_user_limit = operation === "topup"
    ? [
        `AND COALESCE((SELECT credits FROM ${PRIMARY_CARD_TABLE} WHERE user_id = ?), 0)`,
        `+ COALESCE((SELECT SUM(credits) FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ? AND expires_at > ?), 0) <= ?`,
      ].join(" ")
    : "";
  const params: unknown[] = [delta, transaction_id, now, card_id];
  if (operation === "charge") params.push(credits);
  if (kind === "ephemeral") params.push(now);
  if (operation === "topup" && kind === "ephemeral") {
    params.push(user_id, now, MAX_ACTIVE_EPHEMERAL_CARDS);
  }
  if (operation === "topup") params.push(user_id, user_id, now, MAX_USER_CREDITS - credits);
  params.push(transaction_id);
  return {
    sql: [
      `UPDATE ${table} SET credits = credits + ?, transaction_marker = ?, updated_at = ?`,
      `WHERE ${key} = ? ${sufficient} ${unexpired} ${within_card_limit} ${within_user_limit}`,
      `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
    ].join(" "),
    params,
  };
}

/** 构造从当前 Card 快照写入不可变 Entry 的命令。 */
export function insert_entry_from_card_command(
  transaction_id: string,
  index: number,
  kind: "primary" | "ephemeral",
  card_id: string,
  delta: number,
  now: string,
): CreditsRawCommand {
  const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
  const key = kind === "primary" ? "user_id" : "card_id";
  return {
    sql: [
      `INSERT INTO ${TRANSACTION_ENTRY_TABLE}`,
      "(entry_id, transaction_id, user_id, card_kind, card_id, credits_delta, credits_after, created_at)",
      `SELECT ?, ?, user_id, ?, ?, ?, credits, ? FROM ${table}`,
      `WHERE ${key} = ? AND transaction_marker = ?`,
      `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
    ].join(" "),
    params: [`cte_${transaction_id}_${index}`, transaction_id, kind, card_id, delta, now, card_id, transaction_id, transaction_id],
  };
}

/** 使用一条 SQL 原子扣除本次涉及的全部 Ephemeral Cards。 */
export function update_ephemeral_allocations_command(
  transaction_id: string,
  allocations: CreditsCardAllocation[],
  now: string,
): CreditsRawCommand {
  const allocations_json = serialize_ephemeral_allocations(allocations);
  return {
    sql: [
      "WITH allocations AS (",
      "SELECT json_extract(value, '$.card_id') AS card_id,",
      "CAST(json_extract(value, '$.credits') AS INTEGER) AS credits FROM json_each(?)",
      ")",
      `UPDATE ${EPHEMERAL_CARD_TABLE} SET`,
      `credits = credits - (SELECT credits FROM allocations WHERE allocations.card_id = ${EPHEMERAL_CARD_TABLE}.card_id),`,
      "transaction_marker = ?, updated_at = ?",
      "WHERE card_id IN (SELECT card_id FROM allocations)",
      "AND expires_at > ?",
      `AND credits >= (SELECT credits FROM allocations WHERE allocations.card_id = ${EPHEMERAL_CARD_TABLE}.card_id)`,
      `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
    ].join(" "),
    params: [allocations_json, transaction_id, now, now, transaction_id],
  };
}

/** 为全部 Ephemeral Card 扣费构造不可变 Entries。 */
export function insert_ephemeral_allocation_entries_command(
  transaction_id: string,
  allocations: CreditsCardAllocation[],
  now: string,
): CreditsRawCommand {
  const allocations_json = serialize_ephemeral_allocations(allocations);
  return {
    sql: [
      "WITH allocations AS (",
      "SELECT json_extract(value, '$.card_id') AS card_id,",
      "CAST(json_extract(value, '$.credits') AS INTEGER) AS credits,",
      "CAST(json_extract(value, '$.entry_index') AS INTEGER) AS entry_index FROM json_each(?)",
      ")",
      `INSERT INTO ${TRANSACTION_ENTRY_TABLE}`,
      "(entry_id, transaction_id, user_id, card_kind, card_id, credits_delta, credits_after, created_at)",
      "SELECT ? || allocations.entry_index, ?, cards.user_id, 'ephemeral', cards.card_id,",
      "-allocations.credits, cards.credits, ?",
      `FROM ${EPHEMERAL_CARD_TABLE} AS cards JOIN allocations ON allocations.card_id = cards.card_id`,
      "WHERE cards.transaction_marker = ?",
      `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
    ].join(" "),
    params: [allocations_json, `cte_${transaction_id}_`, transaction_id, now, transaction_id, transaction_id],
  };
}

/** Transaction 未完整应用时构造 Ephemeral Cards 恢复命令。 */
export function rollback_ephemeral_allocations_command(
  transaction_id: string,
  allocations: CreditsCardAllocation[],
  now: string,
): CreditsRawCommand {
  const allocations_json = serialize_ephemeral_allocations(allocations);
  return {
    sql: [
      "WITH allocations AS (",
      "SELECT json_extract(value, '$.card_id') AS card_id,",
      "CAST(json_extract(value, '$.credits') AS INTEGER) AS credits FROM json_each(?)",
      ")",
      `UPDATE ${EPHEMERAL_CARD_TABLE} SET`,
      `credits = credits + (SELECT credits FROM allocations WHERE allocations.card_id = ${EPHEMERAL_CARD_TABLE}.card_id),`,
      "updated_at = ?",
      "WHERE card_id IN (SELECT card_id FROM allocations) AND transaction_marker = ?",
      `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
    ].join(" "),
    params: [allocations_json, now, transaction_id, transaction_id],
  };
}

/** 仅在 Entry 数量和额度变化都符合预期时应用 Transaction。 */
export function apply_transaction_command(
  transaction_id: string,
  expected_delta: number,
  entry_count: number,
  now: string,
): CreditsRawCommand {
  return {
    sql: [
      `UPDATE ${TRANSACTION_TABLE} SET status = 'applied', applied_at = ?`,
      "WHERE transaction_id = ? AND status = 'pending'",
      `AND (SELECT COUNT(*) FROM ${TRANSACTION_ENTRY_TABLE} WHERE transaction_id = ?) = ?`,
      `AND (SELECT COALESCE(SUM(credits_delta), 0) FROM ${TRANSACTION_ENTRY_TABLE} WHERE transaction_id = ?) = ?`,
    ].join(" "),
    params: [now, transaction_id, transaction_id, entry_count, transaction_id, expected_delta],
  };
}

/** Transaction 未完整应用时构造单张 Card 恢复命令。 */
export function rollback_card_command(
  transaction_id: string,
  kind: "primary" | "ephemeral",
  card_id: string,
  credits: number,
  operation: "topup" | "charge",
  now: string,
): CreditsRawCommand {
  const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
  const key = kind === "primary" ? "user_id" : "card_id";
  const rollback_delta = operation === "topup" ? -credits : credits;
  return {
    sql: [
      `UPDATE ${table} SET credits = credits + ?, updated_at = ?`,
      `WHERE ${key} = ? AND transaction_marker = ?`,
      `AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
    ].join(" "),
    params: [rollback_delta, now, card_id, transaction_id, transaction_id],
  };
}

/** 构造清理未应用 Entries 与 Transaction 的命令序列。 */
export function cleanup_pending_transaction_commands(
  transaction_id: string,
): CreditsRawCommand[] {
  return [
    {
      sql: `DELETE FROM ${TRANSACTION_ENTRY_TABLE} WHERE transaction_id = ? AND EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending')`,
      params: [transaction_id, transaction_id],
    },
    {
      sql: `DELETE FROM ${TRANSACTION_TABLE} WHERE transaction_id = ? AND status = 'pending'`,
      params: [transaction_id],
    },
  ];
}

/** 构造清理单张 Card 事务标记的命令。 */
export function clear_marker_command(
  kind: "primary" | "ephemeral",
  card_id: string,
  transaction_id: string,
): CreditsRawCommand {
  const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
  const key = kind === "primary" ? "user_id" : "card_id";
  return {
    sql: `UPDATE ${table} SET transaction_marker = '' WHERE ${key} = ? AND transaction_marker = ?`,
    params: [card_id, transaction_id],
  };
}

/** 构造清理一种 Card 上全部指定事务标记的命令。 */
export function clear_markers_command(
  kind: "primary" | "ephemeral",
  transaction_id: string,
): CreditsRawCommand {
  const table = kind === "primary" ? PRIMARY_CARD_TABLE : EPHEMERAL_CARD_TABLE;
  return {
    sql: `UPDATE ${table} SET transaction_marker = '' WHERE transaction_marker = ?`,
    params: [transaction_id],
  };
}

/** 构造删除指定用户或全局过期 Ephemeral Cards 的命令。 */
export function delete_expired_cards_command(
  user_id: string | undefined,
  now: string,
): CreditsRawCommand {
  return user_id
    ? {
        sql: `DELETE FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ? AND expires_at <= ?`,
        params: [user_id, now],
      }
    : {
        sql: `DELETE FROM ${EPHEMERAL_CARD_TABLE} WHERE expires_at <= ?`,
        params: [now],
      };
}

/** 将 Ephemeral 分配压缩为单个 JSON SQL 参数，避免 D1 变量数量膨胀。 */
function serialize_ephemeral_allocations(allocations: CreditsCardAllocation[]): string {
  return stable_stringify(allocations.map((allocation, entry_index) => ({
    card_id: allocation.card_id,
    credits: allocation.credits,
    entry_index,
  })));
}
