/**
 * 上下文 checkpoint 的派生表读写。
 *
 * checkpoint 只记录「累计摘要覆盖到哪个 canonical Part」。它属于 Composer 自己的派生
 * 数据：结构不兼容时直接丢弃重建，因为摘要可以从 canonical history 重新累积。
 */

import { generate_id } from "@/utils/Id.js";
import type { ContextCheckpointRow } from "@/types/session/ContextCheckpoint.js";
import type { SessionDerivedStore } from "@/types/store/SessionStorage.js";

/** checkpoint schema 版本；版本或列结构变化时旧派生表会被重建。 */
export const CHECKPOINT_SCHEMA_VERSION = 1;

/** 返回指定 Composer 命名空间的 checkpoint 表名。 */
export function checkpoint_table(composer_name: string): string {
  return `composer_${composer_name}_checkpoints`;
}

/**
 * 建立 checkpoint schema。
 *
 * 关键点（中文）：派生表可以重建，因此旧结构的表在初始化时被丢弃；新表从当前
 * canonical history 重新累积摘要，不需要迁移脚本。
 */
export async function initialize_checkpoint_schema(
  derived: SessionDerivedStore,
  composer_name: string,
): Promise<void> {
  const table = checkpoint_table(composer_name);
  const compatible = await has_compatible_schema(derived, table);
  await derived.transaction((transaction) => {
    if (!compatible) transaction.execute(`DROP TABLE IF EXISTS ${table}`);
    transaction.execute(`
      CREATE TABLE IF NOT EXISTS ${table} (
        checkpoint_id TEXT PRIMARY KEY,
        through_message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
        through_message_sequence INTEGER NOT NULL,
        through_part_sequence INTEGER NOT NULL,
        summary TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(through_message_sequence, through_part_sequence, schema_version)
      )
    `);
  });
}

/** 读取当前版本位置最靠后的累计 checkpoint。 */
export async function read_latest_checkpoint(
  derived: SessionDerivedStore,
  composer_name: string,
): Promise<ContextCheckpointRow | null> {
  const table = checkpoint_table(composer_name);
  return await derived.transaction((transaction) =>
    transaction.get<ContextCheckpointRow>(`
      SELECT checkpoint_id, through_message_id, through_message_sequence,
             through_part_sequence, summary, schema_version, created_at
      FROM ${table}
      WHERE schema_version = ?
      ORDER BY through_message_sequence DESC, through_part_sequence DESC
      LIMIT 1
    `, [CHECKPOINT_SCHEMA_VERSION])
  );
}

/** 追加一条累计 checkpoint。 */
export async function insert_checkpoint(
  derived: SessionDerivedStore,
  composer_name: string,
  input: {
    /** 边界所属 Message 标识。 */
    through_message_id: string;
    /** 边界所属 Message sequence。 */
    through_message_sequence: number;
    /** 边界 Part sequence。 */
    through_part_sequence: number;
    /** 截至边界的累计摘要正文。 */
    summary: string;
  },
): Promise<void> {
  const table = checkpoint_table(composer_name);
  await derived.transaction((transaction) => {
    transaction.execute(`
      INSERT INTO ${table} (
        checkpoint_id, through_message_id, through_message_sequence,
        through_part_sequence, summary, schema_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      `checkpoint:${generate_id()}`,
      input.through_message_id,
      input.through_message_sequence,
      input.through_part_sequence,
      input.summary,
      CHECKPOINT_SCHEMA_VERSION,
      Date.now(),
    ]);
  });
}

/** 探测现有派生表是否具备当前列结构。 */
async function has_compatible_schema(
  derived: SessionDerivedStore,
  table: string,
): Promise<boolean> {
  try {
    await derived.transaction((transaction) =>
      transaction.get(`SELECT schema_version FROM ${table} LIMIT 1`)
    );
    return true;
  } catch {
    // 表缺失或列结构不兼容都由建表语句一次性收敛。
    return false;
  }
}
