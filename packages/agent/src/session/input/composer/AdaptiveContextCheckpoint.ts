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
export const CHECKPOINT_SCHEMA_VERSION = 2;

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
  // schema 归存储拥有者，Composer 初始化仅验证其 namespace 能力可用。
  void composer_name;
  await derived.read_checkpoint(CHECKPOINT_SCHEMA_VERSION);
}

/** 读取当前版本位置最靠后的累计 checkpoint。 */
export async function read_latest_checkpoint(
  derived: SessionDerivedStore,
  composer_name: string,
): Promise<ContextCheckpointRow | null> {
  void composer_name;
  return await derived.read_checkpoint(CHECKPOINT_SCHEMA_VERSION);
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
  void composer_name;
  await derived.insert_checkpoint({
    ...input, checkpoint_id: `checkpoint:${generate_id()}`,
    schema_version: CHECKPOINT_SCHEMA_VERSION, created_at: Date.now(),
  });
}
