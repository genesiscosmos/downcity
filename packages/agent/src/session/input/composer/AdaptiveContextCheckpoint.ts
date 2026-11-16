/**
 * 上下文 checkpoint 的派生表读写。
 *
 * checkpoint 只记录「累计摘要覆盖到哪个 canonical Part」。它属于 Composer 自己的派生
 * 数据：按 namespace 与协议版本读取，不匹配时返回空，从 canonical history 重新累积。
 * schema 由存储拥有者管理，Composer 不执行 DDL 或删除历史表。
 */

import { generate_id } from "@/utils/Id.js";
import type { ContextCheckpointRow } from "@/types/session/ContextCheckpoint.js";
import type { SessionDerivedStore } from "@/types/store/SessionStorage.js";

/** checkpoint 派生协议版本；读取只匹配该版本，不修改其他版本记录。 */
export const CHECKPOINT_SCHEMA_VERSION = 2;

/** 验证当前命名空间的派生读取能力，不创建或重建表。 */
export async function initialize_checkpoint_schema(
  derived: SessionDerivedStore,
): Promise<void> {
  await derived.read_checkpoint(CHECKPOINT_SCHEMA_VERSION);
}

/** 读取当前版本位置最靠后的累计 checkpoint。 */
export async function read_latest_checkpoint(
  derived: SessionDerivedStore,
): Promise<ContextCheckpointRow | null> {
  return await derived.read_checkpoint(CHECKPOINT_SCHEMA_VERSION);
}

/** 追加一条累计 checkpoint。 */
export async function insert_checkpoint(
  derived: SessionDerivedStore,
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
  await derived.insert_checkpoint({
    ...input, checkpoint_id: `checkpoint:${generate_id()}`,
    schema_version: CHECKPOINT_SCHEMA_VERSION, created_at: Date.now(),
  });
}
