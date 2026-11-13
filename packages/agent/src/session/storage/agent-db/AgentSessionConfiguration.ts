/**
 * Agent DB 的独立配置和 Composer 命名空间持久化。
 *
 * 配置、目录标签和 revision 在同一事务更新；执行配置绑定后不可变。Composer 不再
 * 接收任意 SQL 回调，checkpoint 明确绑定 Session、namespace 和完整稳定单元边界。
 */
import { isDeepStrictEqual as is_deep_strict_equal } from "node:util";
import type { AgentSessionConfigurationUpdate, AgentSessionCheckpointInsert } from "@/types/store/AgentSessionConfiguration.js";
import type { ContextCheckpointRow } from "@/types/session/ContextCheckpoint.js";
import { decode_model_binding } from "../ModelBindingCodec.js";
import { decode_session_message, type SessionMessagePartRow, type SessionMessageRow } from "../SessionStorageCodec.js";
import { group_context_units } from "../../input/composer/ContextStableUnits.js";
import { AgentSessionCatalog } from "./AgentSessionCatalog.js";
import { AgentSessionDatabase } from "./AgentSessionDatabase.js";

/** Agent 配置和 Composer 状态的短事务实现。 */
export class AgentSessionConfiguration {
  private readonly catalog: AgentSessionCatalog;
  constructor(private readonly owner: AgentSessionDatabase) { this.catalog = new AgentSessionCatalog(owner); }

  /** 指定字段才提交；配置事实与目录投影只在这个入口维护。 */
  update(input: AgentSessionConfigurationUpdate): { revision: number } {
    return this.owner.write(input.operation_id, { command: "configure", ...input }, (database) => {
      const record = this.catalog.by_storage_id(input.storage_id);
      if (record.archived) throw new Error("session_archived");
      if (input.expected_revision !== undefined && input.expected_revision !== record.revision) throw new Error("session_revision_conflict");
      const configuration = this.catalog.configuration(input.storage_id);
      if (input.execution_profile && configuration.execution_profile
        && !is_deep_strict_equal(input.execution_profile, JSON.parse(configuration.execution_profile))) {
        throw new Error("session_execution_profile_conflict");
      }
      if (input.model_binding !== undefined) decode_model_binding(JSON.stringify(input.model_binding));
      if (input.system_snapshot !== undefined && input.system_snapshot !== null && !input.system_snapshot.trim()) {
        throw new Error("session_system_snapshot_empty");
      }
      database.prepare(`UPDATE sessions SET workspace_id = ?, title = ?, model_label = ?, timezone = ?,
        revision = revision + 1, updated_at = MAX(updated_at, ?) WHERE session_key = ?`)
        .run(input.workspace_id === undefined ? record.workspace_id : input.workspace_id,
          input.title === undefined ? record.title : input.title,
          input.model_label === undefined ? record.model_label : input.model_label,
          input.timezone ?? record.timezone, input.updated_at, record.session_key);
      database.prepare(`UPDATE session_configuration SET model_binding = ?, approval_mode = ?, execution_profile = ?, system_snapshot = ?
        WHERE session_key = ?`).run(
        input.model_binding === undefined ? configuration.model_binding : JSON.stringify(input.model_binding),
        input.approval_mode === undefined ? configuration.approval_mode : input.approval_mode,
        input.execution_profile === undefined ? configuration.execution_profile : JSON.stringify(input.execution_profile),
        input.system_snapshot === undefined ? configuration.system_snapshot : input.system_snapshot,
        record.session_key,
      );
      return { revision: record.revision + 1 };
    });
  }

  /** 读取指定命名空间/版本的最近累计 checkpoint。 */
  checkpoint(storage_id: string, namespace: string, schema_version: number): ContextCheckpointRow | null {
    this.assert_namespace(namespace);
    return this.owner.read((database) => {
      const record = this.catalog.by_storage_id(storage_id);
      return (database.prepare(`SELECT checkpoint_id, through_message_id, through_message_sequence, through_part_sequence,
        summary, schema_version, created_at FROM composer_checkpoints
        WHERE session_key = ? AND namespace = ? AND schema_version = ?
        ORDER BY through_message_sequence DESC, through_part_sequence DESC LIMIT 1`)
        .get(record.session_key, namespace, schema_version) as unknown as ContextCheckpointRow | undefined) ?? null;
    });
  }

  /** 校验完整 Step/Inbox/User 单元终点后插入；不能仅凭 Part 终态猜边界。 */
  insert_checkpoint(input: AgentSessionCheckpointInsert): { checkpoint_id: string } {
    this.assert_namespace(input.namespace);
    return this.owner.write(input.operation_id, { command: "checkpoint_insert", ...input }, (database) => {
      const record = this.catalog.by_storage_id(input.storage_id);
      if (record.archived) throw new Error("session_archived");
      const row = database.prepare("SELECT * FROM messages WHERE session_key = ? AND message_id = ?")
        .get(record.session_key, input.through_message_id) as unknown as SessionMessageRow | undefined;
      if (!row || row.sequence !== input.through_message_sequence) throw new Error("session_checkpoint_message_invalid");
      const parts = database.prepare("SELECT * FROM message_parts WHERE session_key = ? AND message_id = ? ORDER BY sequence")
        .all(record.session_key, input.through_message_id) as unknown as SessionMessagePartRow[];
      const message = decode_session_message(row, parts, record.session_id);
      if (!group_context_units(message).some(unit => unit.part.sequence === input.through_part_sequence)) {
        throw new Error("session_checkpoint_splits_context_unit");
      }
      database.prepare(`INSERT INTO composer_checkpoints(session_key, namespace, checkpoint_id, through_message_id,
        through_message_sequence, through_part_sequence, summary, schema_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(record.session_key, input.namespace, input.checkpoint_id, input.through_message_id,
          input.through_message_sequence, input.through_part_sequence, input.summary, input.schema_version, input.created_at);
      return { checkpoint_id: input.checkpoint_id };
    });
  }

  private assert_namespace(namespace: string): void {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(namespace)) throw new Error("session_composer_namespace_invalid");
  }
}
