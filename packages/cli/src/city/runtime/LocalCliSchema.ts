/**
 * CLI 专属本地 Schema。
 *
 * Agent、Workspace、Plugin 与安全设置由 `@downcity/local` 初始化；这里仅创建 CLI
 * HTTP Gateway 使用的 Bearer Token 表。
 */

import type { LocalDatabase } from "@downcity/local";

/** 初始化 CLI 独有的本地数据表。 */
export function ensure_cli_local_schema(database: LocalDatabase): void {
  database.execute_script(`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_token_hash_uq
    ON agent_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS agent_tokens_agent_id_idx
    ON agent_tokens(agent_id);
    CREATE INDEX IF NOT EXISTS agent_tokens_expires_at_idx
    ON agent_tokens(expires_at);
  `);
}
