/**
 * Agent DB 的权威 Session 目录查询和生命周期事务。
 *
 * 活动和归档均按永久 session_id 定位；分页直接使用关系索引，COUNT 和页
 * 同事务读取。文件删除仅登记清理日志，数据库提交失败时不会先删附件。
 */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { assert_session_id } from "../../SessionIdentity.js";
import { normalize_session_descriptor, normalize_session_type, normalize_session_kind } from "@downcity/type";
import type { AgentSessionAddress, AgentSessionConfigurationRow, AgentSessionCreateRecord, AgentSessionListQuery, AgentSessionRecord, AgentSessionRecordPage, AgentSessionEnsureCreationInput } from "@/types/store/AgentSessionDatabase.js";
import { AgentSessionDatabase } from "./AgentSessionDatabase.js";
import { decode_agent_session_cursor, encode_agent_session_cursor, storage_digest } from "./AgentSessionCursor.js";
import { decode_session_record, encode_session_relations } from "./AgentSessionRelations.js";

/** AgentStorage 和只读浏览租约共享的同库目录能力。 */
export class AgentSessionCatalog {
  constructor(private readonly owner: AgentSessionDatabase) {}

  /** 创建活动记录；重试使用 operation_id，不能复用归档或已删除身份。 */
  create(operation_id: string, input: AgentSessionCreateRecord): { session_id: string } {
    const descriptor = normalize_session_descriptor(input);
    assert_session_id(input.session_id);
    return this.owner.write(operation_id, { command: "create", input: { ...input, ...normalize_session_descriptor(descriptor) } }, database => {
      this.insert(database, { ...input, ...normalize_session_descriptor(descriptor) });
      return { session_id: input.session_id };
    });
  }

  /** 持久业务键只选择一次 UUID，后续重入不能因归档/删除改选新记录。 */
  ensure_creation(operation_id: string, input: AgentSessionEnsureCreationInput): { session_id: string } {
    assert_session_id(input.session_id);
    const descriptor = normalize_session_descriptor(input);
    if (!input.creation_key || input.creation_key !== input.creation_key.trim() || input.creation_key.length > 512) {
      throw new Error("session_creation_key_invalid");
    }
    return this.owner.write(operation_id, { command: "ensure_creation", input: { ...input, ...normalize_session_descriptor(descriptor) } }, database => {
      const mapped = database.prepare("SELECT session_id FROM session_creation_keys WHERE type = ? AND creation_key = ?")
        .get(descriptor.type, input.creation_key);
      if (mapped) {
        if (database.prepare("SELECT 1 FROM retired_session_ids WHERE session_id = ?").get(mapped.session_id)) throw new Error("session_identity_retired");
        const record = this.by_session_id(String(mapped.session_id));
        if (record.archived) throw new Error("session_archived");
        return { session_id: record.session_id };
      }
      this.insert(database, { ...input, ...normalize_session_descriptor(descriptor) });
      database.prepare("INSERT INTO session_creation_keys(type, creation_key, session_id) VALUES (?, ?, ?)")
        .run(descriptor.type, input.creation_key, input.session_id);
      return { session_id: input.session_id };
    });
  }

  private insert(database: DatabaseSync, input: AgentSessionCreateRecord): void {
    const descriptor = normalize_session_descriptor(input);
    if (database.prepare("SELECT 1 FROM retired_session_ids WHERE session_id = ?").get(input.session_id)) {
      throw new Error("session_identity_retired");
    }
    if (database.prepare("SELECT 1 FROM sessions WHERE session_id = ?").get(input.session_id)) throw new Error("session_address_conflict");
    database.prepare(`INSERT INTO sessions(session_id, type, kind, relations, workspace_id, timezone, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.session_id, descriptor.type, descriptor.kind, encode_session_relations(descriptor), input.workspace_id ?? null,
        input.timezone, input.title?.trim() || null, input.created_at, input.created_at);
  }

  /** 精确活动/归档地址，不扫描目录、不创建数据、不回落另一状态。 */
  find(address: AgentSessionAddress): AgentSessionRecord | null {
    const database = this.owner.database;
    assert_session_id(address.session_id);
    const row = address.type === undefined
      ? database.prepare("SELECT * FROM sessions WHERE session_id = ? AND archived = ?").get(address.session_id, address.archived ? 1 : 0)
      : database.prepare("SELECT * FROM sessions WHERE session_id = ? AND archived = ? AND type = ?")
        .get(address.session_id, address.archived ? 1 : 0, normalize_session_type(address.type));
    return (row as unknown as AgentSessionRecord | undefined) ?? null;
  }

  /** 单条详情可通过稳定记录身份读取；不自动恢复执行器。 */
  by_session_id(session_id: string): AgentSessionRecord {
    assert_session_id(session_id);
    const row = this.owner.database.prepare("SELECT * FROM sessions WHERE session_id = ?").get(session_id);
    if (!row) throw new Error("session_not_found");
    return row as unknown as AgentSessionRecord;
  }

  /** 配置单独读取，禁止让大 system snapshot 阻塞列表和消息请求。 */
  configuration(session_id: string): AgentSessionConfigurationRow {
    const row = this.owner.database.prepare(`SELECT configuration.session_key, configuration.approval_mode, configuration.execution_profile, configuration.system_snapshot FROM session_configuration AS configuration
      JOIN sessions USING (session_key) WHERE session_id = ?`).get(session_id);
    if (!row) throw new Error("session_not_found");
    return row as unknown as AgentSessionConfigurationRow;
  }

  /** 实时 keyset 分页，不保留全量列表快照，也不使用 OFFSET。 */
  list(input: AgentSessionListQuery): AgentSessionRecordPage {
    const type = normalize_session_type(input.type);
    const kind = input.kind === undefined ? undefined : normalize_session_kind(input.kind);
    const workspace_id = input.workspace_id?.trim() || undefined;
    const query = input.query?.trim() || undefined;
    const limit = input.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("session_list_limit_invalid");
    const filter = { type, archived: Boolean(input.archived), kind, workspace_id, query };
    const filter_hash = storage_digest(filter);
    const cursor = input.cursor ? decode_agent_session_cursor(input.cursor, this.owner.metadata, filter_hash) : undefined;
    const clauses = ["type = ?", "archived = ?"];
    const parameters: SQLInputValue[] = [type, filter.archived ? 1 : 0];
    if (kind) { clauses.push("kind = ?"); parameters.push(kind); }
    if (workspace_id) { clauses.push("workspace_id = ?"); parameters.push(workspace_id); }
    if (query) {
      // instr 使用字面包含语义，避免用户输入 %/_ 意外改变匹配范围。
      clauses.push("(instr(lower(session_id), lower(?)) > 0 OR instr(lower(COALESCE(title, '')), lower(?)) > 0 OR instr(lower(COALESCE(preview_text, '')), lower(?)) > 0)");
      parameters.push(query, query, query);
    }
    const where = clauses.join(" AND ");
    return this.owner.read((database) => {
      const total = Number(database.prepare(`SELECT COUNT(*) AS total FROM sessions WHERE ${where}`).get(...parameters)?.total ?? 0);
      const page_where = cursor ? `${where} AND (updated_at < ? OR (updated_at = ? AND session_key < ?))` : where;
      const page_parameters = cursor ? [...parameters, cursor.updated_at, cursor.updated_at, cursor.session_key] : parameters;
      const rows = database.prepare(`SELECT * FROM sessions WHERE ${page_where}
        ORDER BY updated_at DESC, session_key DESC LIMIT ?`).all(...page_parameters, limit + 1) as unknown as AgentSessionRecord[];
      const has_more = rows.length > limit;
      const items = has_more ? rows.slice(0, limit) : rows;
      const last = items.at(-1);
      return {
        items, total, has_more,
        ...(has_more && last ? { next_cursor: encode_agent_session_cursor(this.owner.metadata, filter_hash, last.updated_at, last.session_key) } : {}),
      };
    });
  }

  /** 归档保留永久身份，只更新记录状态。 */
  archive(operation_id: string, address: AgentSessionAddress, archived_at: number): { session_id: string } {
    if (address.archived) throw new Error("session_already_archived");
    return this.owner.write(operation_id, { command: "archive", address, archived_at }, (database) => {
      const record = this.find(address);
      if (!record) throw new Error("session_not_found");
      if (database.prepare("SELECT 1 FROM archive_operation_nodes WHERE session_id = ? AND committed_at IS NULL LIMIT 1").get(record.session_id)) {
        throw new Error("session_archive_plan_reserved");
      }
      database.prepare("UPDATE sessions SET archived = 1, archived_at = ?, revision = revision + 1 WHERE session_key = ?")
        .run(archived_at, record.session_key);
      return { session_id: record.session_id };
    });
  }

  /** 永久删除与附件清理日志原子提交；不在事务之前接触附件文件。 */
  remove(operation_id: string, address: AgentSessionAddress): { removed: boolean; session_id: string | null } {
    return this.owner.write(operation_id, { command: "remove", address }, (database) => {
      const record = this.find(address);
      if (!record) return { removed: false, session_id: null };
      database.prepare("DELETE FROM sessions WHERE session_key = ?").run(record.session_key);
      return { removed: true, session_id: record.session_id };
    });
  }
}
