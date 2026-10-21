/**
 * Session 历史 schema 的原子迁移。
 *
 * 每次迁移都在单个事务内完成，保留全部消息身份、顺序与内容，只改变承载方式。
 * 不支持的旧版本直接返回，由调用方按现有约定报错或走外部迁移脚本。
 */
import type { DatabaseSync } from "node:sqlite";
import {
  SESSION_MESSAGE_META_CHECK_SQL,
  SESSION_STORAGE_SCHEMA_SQL,
} from "./SessionStorageSchema.js";

/** 迁移入口：把已支持的旧版本升级到当前 schema。 */
export function migrate_session_storage(database: DatabaseSync, version: number): void {
  if (version === 3) migrate_v3_to_v4(database);
  if (version === 3 || version === 4) migrate_v4_to_v5(database);
}

/** Session v3 → v4：扩展 Part 类型，保留所有身份、顺序和内容。 */
function migrate_v3_to_v4(database: DatabaseSync): void {
  // message_parts 没有子表引用；事务内重建约束并恢复现有索引和角色触发器。
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      DROP TRIGGER IF EXISTS message_parts_validate_role_insert;
      DROP TRIGGER IF EXISTS message_parts_validate_role_update;
      CREATE TABLE message_parts_v4 (
        part_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        step_id TEXT,
        type TEXT NOT NULL CHECK (type IN (
          'text', 'context', 'reasoning', 'tool', 'interaction',
          'file', 'data', 'power', 'action', 'error'
        )),
        content TEXT NOT NULL CHECK (json_valid(content)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(message_id, sequence)
      );
      INSERT INTO message_parts_v4 SELECT * FROM message_parts;
      DROP TABLE message_parts;
      ALTER TABLE message_parts_v4 RENAME TO message_parts;
    `);
    database.exec(SESSION_STORAGE_SCHEMA_SQL);
    database.exec("PRAGMA user_version = 4; COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Session v4 → v5：把请求记账从 User Message 的 data Part 移入 `messages.meta`。
 *
 * 背景（中文）
 * - 旧实现把 `session_prompt_actor`、`prompt_powers`、`prompt_power_fingerprint`、
 *   `session_callback` 四类 data Part 追加到用户消息的 parts 里。它们是 SDK 的请求记账，
 *   却与用户撰写的内容同构，因而会被消息编辑器恢复、渲染并原样回传，导致身份可被编辑覆盖。
 * - 迁移把其中有用的数据收进消息级只读列 `meta`（发起方为 `meta.from`），并删除对应 Part。
 *   `prompt_power_fingerprint` 是 `powers` 的派生摘要，不再保留：一致性比较直接使用 `powers`。
 *
 * 顺序与身份（中文）
 * - 删除 Part 后消息内的 part sequence 会重新编号，因此旧的上下文 checkpoint 不再对应真实边界。
 *   该处无需额外处理：checkpoint 按 `schema_version` 读取，`CHECKPOINT_SCHEMA_VERSION`
 *   已随本次结构变化递增，旧行自然失效并从头重新累积。
 * - 消息级 sequence、revision、Part 内容本身保持不变；Agent 消息完全不受影响。
 */
function migrate_v4_to_v5(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`ALTER TABLE messages ADD COLUMN meta TEXT CHECK (${SESSION_MESSAGE_META_CHECK_SQL});`);
    const user_messages = database.prepare(
      "SELECT message_id FROM messages WHERE role = 'user'",
    ).all() as unknown as Array<{ message_id: string }>;
    const read_parts = database.prepare(
      "SELECT content FROM message_parts WHERE message_id = ? AND type = 'data' ORDER BY sequence ASC",
    );
    const write_meta = database.prepare("UPDATE messages SET meta = ? WHERE message_id = ?");
    const delete_bookkeeping = database.prepare(`
      DELETE FROM message_parts
      WHERE message_id = ?
        AND type = 'data'
        AND json_extract(content, '$.data_type') IN (
          'session_prompt_actor', 'prompt_powers',
          'prompt_power_fingerprint', 'session_callback'
        )
    `);
    for (const { message_id } of user_messages) {
      const meta = read_legacy_message_meta(
        (read_parts.all(message_id) as unknown as Array<{ content: string }>)
          .map((row) => row.content),
      );
      if (!meta) continue;
      write_meta.run(JSON.stringify(meta), message_id);
      delete_bookkeeping.run(message_id);
    }
    database.exec("PRAGMA user_version = 5; COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** 从旧 data Part 还原消息级记账；没有记账 Part 时返回 null。 */
function read_legacy_message_meta(contents: readonly string[]): Record<string, unknown> | null {
  const data_parts = contents.flatMap((content) => {
    try {
      const parsed = JSON.parse(content) as { data_type?: unknown; data?: unknown };
      return parsed.data_type === undefined
        ? []
        : [{ data_type: String(parsed.data_type), data: parsed.data }];
    } catch {
      // 无法解析的 Part 内容不应让整库迁移失败；交由后续 codec 校验报告。
      return [];
    }
  });
  const read = (data_type: string): unknown =>
    data_parts.find((part) => part.data_type === data_type)?.data;
  const from = read("session_prompt_actor");
  const powers = read("prompt_powers");
  const callback = read("session_callback");
  if (from === undefined && powers === undefined && callback === undefined) {
    return null;
  }
  return {
    ...(from === undefined ? {} : { from }),
    ...(powers === undefined ? {} : { powers }),
    ...(callback === undefined ? {} : { callback }),
  };
}
