/**
 * 本人钱包历史投影：过期卡当前记录可被清理，历史始终从不可变创建交易和流水恢复。
 * 不透传 request_json、metadata 或来源凭据；所有查询强制 user_id 与 card_id 联合约束。
 */
import { httpError, type ServiceDatabaseContext } from "@downcity/federation";
import { raw_all } from "./raw.js";
import { EPHEMERAL_CARD_TABLE, TRANSACTION_TABLE, TRANSACTION_ENTRY_TABLE } from "./schema.js";
import type { CreditsEphemeralCard } from "./types/Card.js";
import { parse_ephemeral_card, parse_transaction_entry, read_limit } from "./utils.js";

export async function read_wallet_cards(database: ServiceDatabaseContext, user_id: string): Promise<CreditsEphemeralCard[]> {
  const rows = await raw_all(database, `SELECT e.card_id, e.created_at, t.request_json,
    (SELECT credits_after FROM ${TRANSACTION_ENTRY_TABLE} z WHERE z.user_id = e.user_id AND z.card_id = e.card_id ORDER BY z.created_at DESC, z.${database.schema_id === "postgresql" ? "ledger_sequence" : "rowid"} DESC LIMIT 1) AS credits,
    (SELECT created_at FROM ${TRANSACTION_ENTRY_TABLE} z WHERE z.user_id = e.user_id AND z.card_id = e.card_id ORDER BY z.created_at DESC, z.${database.schema_id === "postgresql" ? "ledger_sequence" : "rowid"} DESC LIMIT 1) AS updated_at
    FROM ${TRANSACTION_ENTRY_TABLE} e JOIN ${TRANSACTION_TABLE} t ON t.transaction_id = e.transaction_id
    WHERE e.user_id = ? AND e.card_kind = 'ephemeral' AND t.status = 'applied' AND t.kind = 'topup' ORDER BY e.created_at DESC`, [user_id]);
  const cards = new Map<string, CreditsEphemeralCard>();
  for (const row of rows) {
    const request = JSON.parse(String(row.request_json));
    if (request.mode !== "create_ephemeral" || cards.has(String(row.card_id))) continue;
    cards.set(String(row.card_id), parse_ephemeral_card({ ...row, user_id, name: request.name, expires_at: request.expires_at, source: request.source, ref: request.ref }));
  }
  const live = await raw_all(database, `SELECT * FROM ${EPHEMERAL_CARD_TABLE} WHERE user_id = ?`, [user_id]);
  for (const row of live) cards.set(String(row.card_id), parse_ephemeral_card(row));
  return [...cards.values()].sort((a,b) => a.expires_at.localeCompare(b.expires_at));
}
export async function read_wallet_entries(database: ServiceDatabaseContext, user_id: string, card_id: string, limit?: string) {
  // Primary 的 card_id 就是本人 user_id；历史卡也必须通过本人不可变流水确认归属。
  if (card_id !== user_id) {
    const owner = await raw_all(database, `SELECT entry_id FROM ${TRANSACTION_ENTRY_TABLE} WHERE user_id = ? AND card_id = ? AND card_kind = 'ephemeral' LIMIT 1`, [user_id, card_id]);
    if (!owner.length) throw httpError(404, "card not found");
  }
  const rows = await raw_all(database, `SELECT * FROM ${TRANSACTION_ENTRY_TABLE} WHERE user_id = ? AND card_id = ? AND card_kind = ? ORDER BY created_at DESC, ${database.schema_id === "postgresql" ? "ledger_sequence" : "rowid"} DESC LIMIT ?`, [user_id, card_id, card_id === user_id ? "primary" : "ephemeral", read_limit(limit)]);
  return rows.map(parse_transaction_entry).map(row => ({ entry_id: row.entry_id, transaction_id: row.transaction_id, card_id: row.card_id, card_kind: row.card_kind, credits_delta: row.credits_delta, credits_after: row.credits_after, created_at: row.created_at }));
}
