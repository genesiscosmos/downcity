/**
 * Agent DB 的权威 Session 目录查询和生命周期事务。
 *
 * 活动按逻辑地址定位，归档按 storage_id 定位；分页直接使用关系索引，COUNT 和页
 * 同事务读取。文件删除仅登记清理日志，数据库提交失败时不会先删附件。
 */
import type { SQLInputValue } from "node:sqlite";
import { normalize_session_origin, normalize_session_origin_category } from "@downcity/type";
import type {
  AgentSessionAddress, AgentSessionConfigurationRow, AgentSessionCreateRecord,
  AgentSessionListQuery, AgentSessionRecord, AgentSessionRecordPage,
} from "@/types/store/AgentSessionDatabase.js";
import { AgentSessionDatabase } from "./AgentSessionDatabase.js";
import { decode_agent_session_cursor, encode_agent_session_cursor, storage_digest } from "./AgentSessionCursor.js";

/** AgentStorage 和只读浏览租约共享的同库目录能力。 */
export class AgentSessionCatalog {
  constructor(private readonly owner: AgentSessionDatabase) {}

  /** 创建活动记录；重试使用 operation_id，不能让归档附件与新主会话共用。 */
  create(operation_id: string, input: AgentSessionCreateRecord): { storage_id: string } {
    const origin = normalize_session_origin(input.origin);
    if (input.session_id !== input.session_id.trim() || !input.session_id) throw new Error("session_storage_address_invalid");
    return this.owner.write(operation_id, { command: "create", input: { ...input, origin } }, (database) => {
      const existing = database.prepare("SELECT storage_id, origin FROM sessions WHERE category = ? AND session_id = ? AND archived = 0")
        .get(origin.category, input.session_id);
      if (existing) throw new Error("session_address_conflict");
      const encoded_origin = JSON.stringify(origin);
      database.prepare(`INSERT INTO sessions(storage_id, session_id, category, origin, workspace_id, timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.storage_id, input.session_id, origin.category, encoded_origin, input.workspace_id ?? null,
          input.timezone, input.created_at, input.created_at);
      return { storage_id: input.storage_id };
    });
  }

  /** 精确活动/归档地址，不扫描目录、不创建数据、不回落另一状态。 */
  find(address: AgentSessionAddress): AgentSessionRecord | null {
    const database = this.owner.database;
    const row = address.archived
      ? database.prepare("SELECT * FROM sessions WHERE storage_id = ? AND archived = 1").get(address.storage_id)
      : database.prepare("SELECT * FROM sessions WHERE category = ? AND session_id = ? AND archived = 0")
        .get(normalize_session_origin_category(address.category), address.session_id);
    return (row as unknown as AgentSessionRecord | undefined) ?? null;
  }

  /** 单条详情可通过稳定记录身份读取；不自动恢复执行器。 */
  by_storage_id(storage_id: string): AgentSessionRecord {
    const row = this.owner.database.prepare("SELECT * FROM sessions WHERE storage_id = ?").get(storage_id);
    if (!row) throw new Error("session_not_found");
    return row as unknown as AgentSessionRecord;
  }

  /** 配置单独读取，禁止让大 system snapshot 阻塞列表和消息请求。 */
  configuration(storage_id: string): AgentSessionConfigurationRow {
    const row = this.owner.database.prepare(`SELECT configuration.* FROM session_configuration AS configuration
      JOIN sessions USING (session_key) WHERE storage_id = ?`).get(storage_id);
    if (!row) throw new Error("session_not_found");
    return row as unknown as AgentSessionConfigurationRow;
  }

  /** 实时 keyset 分页，不保留全量列表快照，也不使用 OFFSET。 */
  list(input: AgentSessionListQuery): AgentSessionRecordPage {
    const category = normalize_session_origin_category(input.category);
    const origin_type = input.origin_type?.trim() || undefined;
    const workspace_id = input.workspace_id?.trim() || undefined;
    const query = input.query?.trim() || undefined;
    const limit = input.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("session_list_limit_invalid");
    const filter = { category, archived: Boolean(input.archived), origin_type, workspace_id, query };
    const filter_hash = storage_digest(filter);
    const cursor = input.cursor ? decode_agent_session_cursor(input.cursor, this.owner.metadata, filter_hash) : undefined;
    const clauses = ["category = ?", "archived = ?"];
    const parameters: SQLInputValue[] = [category, filter.archived ? 1 : 0];
    if (origin_type) { clauses.push("json_extract(origin, '$.type') = ?"); parameters.push(origin_type); }
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

  /** 归档只修改状态与 revision；stable storage_id 和附件目录保持不变。 */
  archive(operation_id: string, address: AgentSessionAddress, archived_at: number): { storage_id: string } {
    if (address.archived) throw new Error("session_already_archived");
    return this.owner.write(operation_id, { command: "archive", address, archived_at }, (database) => {
      const record = this.find(address);
      if (!record) throw new Error("session_not_found");
      if (database.prepare("SELECT 1 FROM archive_operation_nodes WHERE storage_id = ? AND committed_at IS NULL LIMIT 1").get(record.storage_id)) {
        throw new Error("session_archive_plan_reserved");
      }
      database.prepare("UPDATE sessions SET archived = 1, archived_at = ?, updated_at = ?, revision = revision + 1 WHERE session_key = ?")
        .run(archived_at, archived_at, record.session_key);
      return { storage_id: record.storage_id };
    });
  }

  /** 永久删除与附件清理日志原子提交；不在事务之前接触附件文件。 */
  remove(operation_id: string, address: AgentSessionAddress): { removed: boolean; storage_id: string | null } {
    return this.owner.write(operation_id, { command: "remove", address }, (database) => {
      const record = this.find(address);
      if (!record) return { removed: false, storage_id: null };
      database.prepare("DELETE FROM sessions WHERE session_key = ?").run(record.session_key);
      return { removed: true, storage_id: record.storage_id };
    });
  }
}
