/**
 * Chat Access SQLite Store。
 *
 * 关键点（中文）
 * - 该 Store 是当前 Agent Chat Access 的唯一持久化入口。
 * - 所有字段先归一化再写入，避免平台适配器差异污染查询键。
 * - Service 负责业务编排，Store 只负责结构化读写和事务。
 */

import { DatabaseSync } from "node:sqlite";
import fs from "fs-extra";
import path from "node:path";
import { generate_id } from "@downcity/agent";
import { ensure_chat_access_schema } from "@/chat/access/ChatAccessSchema.js";
import type {
  ChatAccessEffect,
  ChatAccessGrant,
  ChatAccessPrincipal,
  ChatAccessPrincipalView,
  ChatAccessRequest,
  ChatAccessRequestStatus,
  ChatAccessRequestView,
  ChatAccessScope,
  CreateChatAccessRequestInput,
  CreateChatAccessRequestResult,
  InsertChatAccessAuditEventInput,
  ResolveChatAccessRequestStoreInput,
  ResolvePendingChatAccessRequestsInput,
  UpsertChatAccessGrantInput,
  UpsertChatAccessPrincipalInput,
} from "@/chat/types/ChatAccess.js";
import type { ChatDispatchChannel } from "@/chat/types/ChatDispatcher.js";

type SqlRow = Record<string, unknown>;

/**
 * 返回 AgentWorkspace Chat Access 数据库路径。
 */
export function get_chat_access_db_path(data_path: string): string {
  return path.join(path.resolve(data_path), "chat", "access.db");
}

function normalize_text(value: unknown): string {
  return String(value || "").trim();
}

function optional_text(value: unknown): string | undefined {
  const text = normalize_text(value);
  return text || undefined;
}

function now_iso(): string {
  return new Date().toISOString();
}

function to_principal(row: SqlRow | undefined): ChatAccessPrincipal | null {
  if (!row) return null;
  const principal_id = normalize_text(row.principal_id);
  const channel = normalize_text(row.channel) as ChatDispatchChannel;
  const issuer = normalize_text(row.issuer);
  const subject_id = normalize_text(row.subject_id);
  if (!principal_id || !channel || !issuer || !subject_id) return null;
  return {
    principal_id,
    channel,
    issuer,
    subject_id,
    ...(optional_text(row.display_name)
      ? { display_name: optional_text(row.display_name) }
      : {}),
    first_seen_at: normalize_text(row.first_seen_at),
    last_seen_at: normalize_text(row.last_seen_at),
    ...(optional_text(row.last_chat_id)
      ? { last_chat_id: optional_text(row.last_chat_id) }
      : {}),
    ...(optional_text(row.last_chat_type)
      ? { last_chat_type: optional_text(row.last_chat_type) }
      : {}),
  };
}

function to_grant(row: SqlRow | undefined): ChatAccessGrant | null {
  if (!row) return null;
  const grant_id = normalize_text(row.grant_id);
  const principal_id = normalize_text(row.principal_id);
  const scope = normalize_text(row.scope) as ChatAccessScope;
  const effect = normalize_text(row.effect) as ChatAccessEffect;
  if (!grant_id || !principal_id || !scope || !effect) return null;
  return {
    grant_id,
    principal_id,
    scope,
    effect,
    created_by: normalize_text(row.created_by),
    created_at: normalize_text(row.created_at),
    updated_at: normalize_text(row.updated_at),
  };
}

function to_request(row: SqlRow | undefined): ChatAccessRequest | null {
  if (!row) return null;
  const request_id = normalize_text(row.request_id);
  const principal_id = normalize_text(row.principal_id);
  const scope = normalize_text(row.scope) as ChatAccessScope;
  const status = normalize_text(row.status) as ChatAccessRequestStatus;
  if (!request_id || !principal_id || !scope || !status) return null;
  return {
    request_id,
    principal_id,
    scope,
    chat_id: normalize_text(row.chat_id),
    chat_type: normalize_text(row.chat_type),
    status,
    ...(optional_text(row.resolved_by)
      ? { resolved_by: optional_text(row.resolved_by) }
      : {}),
    created_at: normalize_text(row.created_at),
    last_requested_at: normalize_text(row.last_requested_at),
    ...(optional_text(row.resolved_at)
      ? { resolved_at: optional_text(row.resolved_at) }
      : {}),
  };
}

/**
 * 当前 Agent 的 Chat Access SQLite Store。
 */
export class ChatAccessStore {
  private readonly database: DatabaseSync;

  /**
   * 打开当前项目 Chat Access 数据库。
   */
  constructor(data_path: string) {
    const database_path = get_chat_access_db_path(data_path);
    fs.ensureDirSync(path.dirname(database_path), { mode: 0o700 });
    this.database = new DatabaseSync(database_path);
    ensure_chat_access_schema(this.database);
    try {
      fs.chmodSync(database_path, 0o600);
    } catch {
      // 某些平台不支持 POSIX 权限，SQLite 仍可正常工作。
    }
  }

  /** 关闭数据库连接。 */
  close(): void {
    this.database.close();
  }

  /** 在单个 SQLite 事务中执行操作。 */
  transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  /** 读取 Store 元信息。 */
  get_meta(key: string): string | null {
    const row = this.database
      .prepare("SELECT value FROM chat_access_meta WHERE key = ? LIMIT 1")
      .get(normalize_text(key)) as SqlRow | undefined;
    return row ? normalize_text(row.value) : null;
  }

  /** 写入 Store 元信息。 */
  set_meta(key: string, value: string): void {
    const current_time = now_iso();
    this.database.prepare(`
      INSERT INTO chat_access_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(normalize_text(key), normalize_text(value), current_time);
  }

  /** 判断是否已经存在业务数据。 */
  has_access_data(): boolean {
    const row = this.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM chat_access_principals) +
        (SELECT COUNT(*) FROM chat_access_grants) +
        (SELECT COUNT(*) FROM chat_access_requests) AS total
    `).get() as { total?: unknown } | undefined;
    return Number(row?.total || 0) > 0;
  }

  /** 读取指定平台身份对应主体。 */
  get_principal_by_identity(input: {
    channel: ChatDispatchChannel;
    issuer: string;
    subject_id: string;
  }): ChatAccessPrincipal | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_access_principals
      WHERE channel = ? AND issuer = ? AND subject_id = ?
      LIMIT 1
    `).get(
      input.channel,
      normalize_text(input.issuer),
      normalize_text(input.subject_id),
    ) as SqlRow | undefined;
    return to_principal(row);
  }

  /** 按 Principal ID 读取主体。 */
  get_principal(principal_id: string): ChatAccessPrincipal | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_access_principals
      WHERE principal_id = ?
      LIMIT 1
    `).get(normalize_text(principal_id)) as SqlRow | undefined;
    return to_principal(row);
  }

  /** 新增或更新观测主体。 */
  upsert_principal(input: UpsertChatAccessPrincipalInput): ChatAccessPrincipal {
    const existing = this.get_principal_by_identity(input);
    const current_time = now_iso();
    const principal_id = existing?.principal_id || `principal_${generate_id()}`;
    const first_seen_at = normalize_text(input.first_seen_at) || existing?.first_seen_at || current_time;
    const last_seen_at = normalize_text(input.last_seen_at) || current_time;
    this.database.prepare(`
      INSERT INTO chat_access_principals (
        principal_id, channel, issuer, subject_id, display_name,
        first_seen_at, last_seen_at, last_chat_id, last_chat_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, issuer, subject_id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, chat_access_principals.display_name),
        last_seen_at = excluded.last_seen_at,
        last_chat_id = COALESCE(excluded.last_chat_id, chat_access_principals.last_chat_id),
        last_chat_type = COALESCE(excluded.last_chat_type, chat_access_principals.last_chat_type)
    `).run(
      principal_id,
      input.channel,
      normalize_text(input.issuer),
      normalize_text(input.subject_id),
      optional_text(input.display_name) || null,
      first_seen_at,
      last_seen_at,
      optional_text(input.chat_id) || null,
      optional_text(input.chat_type) || null,
    );
    const principal = this.get_principal_by_identity(input);
    if (!principal) throw new Error("Failed to persist Chat Access principal");
    return principal;
  }

  /** 读取指定主体和范围的 Grant。 */
  get_grant(principal_id: string, scope: ChatAccessScope): ChatAccessGrant | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_access_grants
      WHERE principal_id = ? AND scope = ?
      LIMIT 1
    `).get(normalize_text(principal_id), scope) as SqlRow | undefined;
    return to_grant(row);
  }

  /** 新增或更新 Grant。 */
  upsert_grant(input: UpsertChatAccessGrantInput): ChatAccessGrant {
    const existing = this.get_grant(input.principal_id, input.scope);
    const current_time = now_iso();
    const grant_id = existing?.grant_id || `grant_${generate_id()}`;
    this.database.prepare(`
      INSERT INTO chat_access_grants (
        grant_id, principal_id, scope, effect, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(principal_id, scope) DO UPDATE SET
        effect = excluded.effect,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at
    `).run(
      grant_id,
      normalize_text(input.principal_id),
      input.scope,
      input.effect,
      normalize_text(input.operator) || "unknown",
      existing?.created_at || current_time,
      current_time,
    );
    const grant = this.get_grant(input.principal_id, input.scope);
    if (!grant) throw new Error("Failed to persist Chat Access grant");
    return grant;
  }

  /** 删除指定主体和范围的 Grant。 */
  delete_grant(principal_id: string, scope: ChatAccessScope): boolean {
    const result = this.database.prepare(`
      DELETE FROM chat_access_grants
      WHERE principal_id = ? AND scope = ?
    `).run(normalize_text(principal_id), scope);
    return result.changes > 0;
  }

  /** 读取指定主体全部 Grant。 */
  list_grants(principal_id: string): ChatAccessGrant[] {
    const rows = this.database.prepare(`
      SELECT * FROM chat_access_grants
      WHERE principal_id = ?
      ORDER BY scope ASC
    `).all(normalize_text(principal_id)) as SqlRow[];
    return rows.map((row) => to_grant(row)).filter((item): item is ChatAccessGrant => !!item);
  }

  /** 读取 Request。 */
  get_request(request_id: string): ChatAccessRequest | null {
    const row = this.database.prepare(`
      SELECT * FROM chat_access_requests
      WHERE request_id = ?
      LIMIT 1
    `).get(normalize_text(request_id)) as SqlRow | undefined;
    return to_request(row);
  }

  /** 创建或复用 pending Request。 */
  create_or_touch_request(input: CreateChatAccessRequestInput): CreateChatAccessRequestResult {
    const pending_row = this.database.prepare(`
      SELECT * FROM chat_access_requests
      WHERE principal_id = ? AND scope = ? AND status = 'pending'
      LIMIT 1
    `).get(normalize_text(input.principal_id), input.scope) as SqlRow | undefined;
    const pending = to_request(pending_row);
    const current_time = now_iso();
    if (pending) {
      this.database.prepare(`
        UPDATE chat_access_requests
        SET chat_id = ?, chat_type = ?, last_requested_at = ?
        WHERE request_id = ?
      `).run(
        normalize_text(input.chat_id),
        normalize_text(input.chat_type),
        current_time,
        pending.request_id,
      );
      const updated = this.get_request(pending.request_id);
      if (!updated) throw new Error("Failed to update Chat Access request");
      return { request: updated, created: false };
    }

    const request_id = `req_${generate_id()}`;
    this.database.prepare(`
      INSERT INTO chat_access_requests (
        request_id, principal_id, scope, chat_id, chat_type, status,
        created_at, last_requested_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      request_id,
      normalize_text(input.principal_id),
      input.scope,
      normalize_text(input.chat_id),
      normalize_text(input.chat_type),
      current_time,
      current_time,
    );
    const request = this.get_request(request_id);
    if (!request) throw new Error("Failed to create Chat Access request");
    return { request, created: true };
  }

  /** 解决指定 Request。 */
  resolve_request(input: ResolveChatAccessRequestStoreInput): ChatAccessRequest {
    const current_time = now_iso();
    const result = this.database.prepare(`
      UPDATE chat_access_requests
      SET status = ?, resolved_by = ?, resolved_at = ?, last_requested_at = ?
      WHERE request_id = ? AND status = 'pending'
    `).run(
      input.status,
      normalize_text(input.operator) || "unknown",
      current_time,
      current_time,
      normalize_text(input.request_id),
    );
    if (result.changes === 0) {
      throw new Error(`Pending Chat Access request not found: ${input.request_id}`);
    }
    const request = this.get_request(input.request_id);
    if (!request) throw new Error(`Chat Access request not found: ${input.request_id}`);
    return request;
  }

  /** 解决指定主体和范围内的全部 pending Request。 */
  resolve_pending_requests(input: ResolvePendingChatAccessRequestsInput): void {
    if (input.scopes.length === 0) return;
    const current_time = now_iso();
    const placeholders = input.scopes.map(() => "?").join(", ");
    this.database.prepare(`
      UPDATE chat_access_requests
      SET status = ?, resolved_by = ?, resolved_at = ?, last_requested_at = ?
      WHERE principal_id = ?
        AND status = 'pending'
        AND scope IN (${placeholders})
    `).run(
      input.status,
      normalize_text(input.operator) || "unknown",
      current_time,
      current_time,
      normalize_text(input.principal_id),
      ...input.scopes,
    );
  }

  /** 列出 Request 及主体详情。 */
  list_requests(status?: ChatAccessRequestStatus): ChatAccessRequestView[] {
    const rows = status
      ? this.database.prepare(`
          SELECT * FROM chat_access_requests
          WHERE status = ?
          ORDER BY last_requested_at DESC
        `).all(status) as SqlRow[]
      : this.database.prepare(`
          SELECT * FROM chat_access_requests
          ORDER BY last_requested_at DESC
        `).all() as SqlRow[];
    const views: ChatAccessRequestView[] = [];
    for (const row of rows) {
      const request = to_request(row);
      if (!request) continue;
      const principal = this.get_principal(request.principal_id);
      if (!principal) continue;
      views.push({ ...request, principal });
    }
    return views;
  }

  /** 列出所有主体和 Grant。 */
  list_principals(): ChatAccessPrincipalView[] {
    const rows = this.database.prepare(`
      SELECT * FROM chat_access_principals
      ORDER BY last_seen_at DESC
    `).all() as SqlRow[];
    const views: ChatAccessPrincipalView[] = [];
    for (const row of rows) {
      const principal = to_principal(row);
      if (!principal) continue;
      views.push({
        principal,
        grants: this.list_grants(principal.principal_id),
      });
    }
    return views;
  }

  /** 写入审计事件。 */
  insert_audit_event(input: InsertChatAccessAuditEventInput): void {
    this.database.prepare(`
      INSERT INTO chat_access_audit_events (
        event_id, principal_id, request_id, action, scope,
        decision, operator, detail_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `audit_${generate_id()}`,
      optional_text(input.principal_id) || null,
      optional_text(input.request_id) || null,
      normalize_text(input.action),
      input.scope || null,
      optional_text(input.decision) || null,
      optional_text(input.operator) || null,
      input.detail ? JSON.stringify(input.detail) : null,
      now_iso(),
    );
  }
}
