/**
 * CLI Agent HTTP Bearer Token 仓储。
 *
 * 本模块拥有 Token 表的查询规则；底层数据库连接由 CLI 组合根注入。
 */

import type { LocalDatabase } from "@downcity/local";
import type { AgentTokenSummary } from "@/city/types/auth/AgentToken.js";

/** Agent Token 内部持久化记录。 */
export interface AgentTokenRecord extends AgentTokenSummary {
  /** Bearer Token 的 SHA-256 哈希。 */
  token_hash: string;
}

/** Agent Token 数据库行。 */
interface AgentTokenRow {
  /** Token 记录 ID。 */
  id: string;
  /** Token 所属 Agent ID。 */
  agent_id: string;
  /** 用户可见名称。 */
  name: string;
  /** Bearer Token 哈希。 */
  token_hash: string;
  /** 可选过期时间。 */
  expires_at: string | null;
  /** 可选最近使用时间。 */
  last_used_at: string | null;
  /** 创建时间。 */
  created_at: string;
  /** 更新时间。 */
  updated_at: string;
}

/** 管理 CLI Gateway 的单 Agent Bearer Token。 */
export class AgentTokenRepository {
  constructor(private readonly database: LocalDatabase) {}

  /** 按 Agent 列出 Token。 */
  list(agent_id: string): AgentTokenRecord[] {
    const rows = this.database.prepare(`
      SELECT * FROM agent_tokens WHERE agent_id = ? ORDER BY created_at DESC;
    `).all(agent_id) as unknown as AgentTokenRow[];
    return rows.map(decode_agent_token);
  }

  /** 按哈希读取 Token。 */
  get_by_hash(token_hash: string): AgentTokenRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM agent_tokens WHERE token_hash = ? LIMIT 1;
    `).get(token_hash) as unknown as AgentTokenRow | undefined;
    return row ? decode_agent_token(row) : null;
  }

  /** 写入新 Token。 */
  create(record: AgentTokenRecord): void {
    this.database.prepare(`
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
  touch(token_id: string, current_time: string): void {
    this.database.prepare(`
      UPDATE agent_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?;
    `).run(current_time, current_time, token_id);
  }

  /** 删除属于指定 Agent 的 Token。 */
  remove(agent_id: string, token_id: string): boolean {
    const result = this.database.prepare(`
      DELETE FROM agent_tokens WHERE agent_id = ? AND id = ?;
    `).run(agent_id, token_id);
    return Number(result.changes) > 0;
  }

  /** 删除一个 Agent 的全部 Gateway Token。 */
  remove_all(agent_id: string): void {
    this.database.prepare("DELETE FROM agent_tokens WHERE agent_id = ?;").run(agent_id);
  }
}

/** 把数据库行投影为 Token 内部记录。 */
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
