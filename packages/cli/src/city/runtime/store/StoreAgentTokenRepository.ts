/**
 * 单 Agent Bearer Token 行存储。
 *
 * 关键点（中文）：数据库只保存 Token 哈希，明文只在签发响应中出现一次。
 */

import type { PlatformStoreContext } from "@/city/runtime/store/StoreShared.js";
import type { AgentTokenSummary } from "@/city/types/auth/AgentToken.js";

/** Agent Token 数据库内部记录。 */
export interface AgentTokenRecord extends AgentTokenSummary {
  /** Bearer Token 的 SHA-256 哈希。 */
  token_hash: string;
}

type AgentTokenRow = {
  id: string;
  agent_id: string;
  name: string;
  token_hash: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

/** 把数据库行转换为内部记录。 */
function decode_agent_token(row: AgentTokenRow): AgentTokenRecord {
  return {
    token_id: row.id,
    agent_id: row.agent_id,
    name: row.name,
    token_hash: row.token_hash,
    ...(row.expires_at ? { expires_at: row.expires_at } : {}),
    ...(row.last_used_at ? { last_used_at: row.last_used_at } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 按 Agent 列出 Token。 */
export function list_agent_token_rows(
  context: PlatformStoreContext,
  agent_id: string,
): AgentTokenRecord[] {
  const rows = context.sqlite.prepare(`
    SELECT * FROM agent_tokens WHERE agent_id = ? ORDER BY created_at DESC;
  `).all(agent_id) as AgentTokenRow[];
  return rows.map(decode_agent_token);
}

/** 按哈希读取 Token。 */
export function get_agent_token_row_by_hash(
  context: PlatformStoreContext,
  token_hash: string,
): AgentTokenRecord | null {
  const row = context.sqlite.prepare(`
    SELECT * FROM agent_tokens WHERE token_hash = ? LIMIT 1;
  `).get(token_hash) as AgentTokenRow | undefined;
  return row ? decode_agent_token(row) : null;
}

/** 写入新 Token。 */
export function insert_agent_token_row(
  context: PlatformStoreContext,
  record: AgentTokenRecord,
): void {
  context.sqlite.prepare(`
    INSERT INTO agent_tokens (
      id, agent_id, name, token_hash, expires_at, last_used_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `).run(
    record.token_id,
    record.agent_id,
    record.name,
    record.token_hash,
    record.expires_at ?? null,
    record.last_used_at ?? null,
    record.created_at,
    record.updated_at,
  );
}

/** 更新 Token 最近使用时间。 */
export function touch_agent_token_row(
  context: PlatformStoreContext,
  token_id: string,
  current_time: string,
): void {
  context.sqlite.prepare(`
    UPDATE agent_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?;
  `).run(current_time, current_time, token_id);
}

/** 删除属于指定 Agent 的 Token。 */
export function remove_agent_token_row(
  context: PlatformStoreContext,
  agent_id: string,
  token_id: string,
): boolean {
  const result = context.sqlite.prepare(`
    DELETE FROM agent_tokens WHERE agent_id = ? AND id = ?;
  `).run(agent_id, token_id);
  return result.changes > 0;
}
