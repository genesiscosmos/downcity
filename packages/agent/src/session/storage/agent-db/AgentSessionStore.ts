/**
 * Agent 全部活动和归档 Session 的正式单库集合存储。
 *
 * 集合拥有唯一存储租约和 Session 视图缓存；列表查询权威 sessions 表，归档只改变
 * 记录状态。只读浏览不构造执行器。历史分库仅用于检测待迁移，不读取旧 canonical。
 */
import path from "node:path";
import { isDeepStrictEqual as is_deep_strict_equal } from "node:util";
import { randomUUID as random_uuid } from "node:crypto";
import { normalize_session_origin, normalize_session_origin_category, restore_session_origin } from "@downcity/type";
import type { SessionOrigin } from "@downcity/type";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { AgentSessionStoreOptions } from "@/types/store/AgentSessionStore.js";
import type { AgentSessionRuntimeLease } from "@/types/store/AgentSessionRuntime.js";
import type { AgentSessionRecord, AgentSessionRecordPage } from "@/types/store/AgentSessionDatabase.js";
import type { AgentListSessionsInput, AgentSessionSummaryPage, AgentArchiveSessionsInput, AgentArchiveSessionsResult, AgentArchiveSessionResult, AgentCleanArchiveResult } from "@/types/agent/SessionTypes.js";
import type { AgentInteraction } from "@/types/agent/AgentInteractions.js";
import { project_agent_session_metadata, agent_session_read_view } from "./AgentSessionReadView.js";
import { collect_pending_interactions, project_agent_interaction } from "../SessionInteractionReader.js";
import { acquire_agent_session_storage } from "./AgentSessionRuntime.js";
import { AgentSessionStorage } from "./AgentSessionStorage.js";

/** SessionStorage 视图连接同 Agent 的共享数据库。 */
export class AgentSessionStore implements SessionStore {
  private lease?: Promise<AgentSessionRuntimeLease>;
  private reader?: Promise<AgentSessionRuntimeLease>;
  private readonly sessions = new Map<string, AgentSessionStorage>();
  private disposed = false;
  private readonly memory_scope = random_uuid();

  constructor(private readonly options: AgentSessionStoreOptions) {}

  /** 读取主指针只返回持久视图，缺失的新文件根不隐式初始化。 */
  async read_main() {
    try {
      const lease = await this.read_connection();
      const row = await lease.read<AgentSessionRecord | null>({ command: "main" });
      return row ? agent_session_read_view(lease, this.options.agent_id, row) : null;
    } catch (error) {
      if (error instanceof Error && error.message === "session_storage_not_found") return null;
      throw error;
    }
  }

  /** 候选与操作 UUID 在派发前固定；未知确认交由原 receipt 核对。 */
  async ensure_main(workspace_id?: string): Promise<AgentSessionStorage> {
    const lease = await this.connection();
    const selected = await lease.write<{ session_id: string }>("main", {
      command: "ensure_main", operation_id: random_uuid(),
      input: { session_id: random_uuid(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        created_at: Date.now(), ...(workspace_id ? { workspace_id } : {}) },
    });
    return await this.open_session(selected.session_id, "chat");
  }

  /** 业务幂等键与候选 UUID 一起提交；不会从业务键推导会话身份。 */
  async ensure_creation(creation_key: string, origin: SessionOrigin, workspace_id?: string): Promise<AgentSessionStorage> {
    const lease = await this.connection();
    const selected = await lease.write<{ session_id: string }>("creation", {
      command: "ensure_creation", operation_id: random_uuid(), input: {
        creation_key, origin, session_id: random_uuid(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        created_at: Date.now(), ...(workspace_id ? { workspace_id } : {}),
      },
    });
    return await this.open_session(selected.session_id, origin.category);
  }

  /** 同步创建惰性视图；真实记录写入由 initialize 明确确认。 */
  create_session(session_id: string, origin: SessionOrigin, workspace_id = this.options.workspace_id): AgentSessionStorage {
    const normalized = normalize_session_origin(origin);
    const key = this.key(session_id, normalized.category);
    const existing = this.sessions.get(key);
    if (existing) {
      if (!is_deep_strict_equal(existing.origin, normalized)) throw new Error("session_storage_identity_conflict");
      return existing;
    }
    // 视图的租约代理保持同步 create API，所有实际请求仍等待唯一拥有者 ready。
    const lease: AgentSessionRuntimeLease = {
      read: async (operation, signal) => await (await this.connection()).read(operation, signal),
      write: async (session, operation, settings) => await (await this.connection()).write(session, operation, settings),
      release: async () => {},
    };
    const storage = new AgentSessionStorage({ ...this.options, session_id, origin: normalized, workspace_id, lease });
    this.sessions.set(key, storage);
    return storage;
  }

  async open_session(session_id: string, category = "work"): Promise<AgentSessionStorage> {
    const key = this.key(session_id, category);
    const cached = this.sessions.get(key);
    if (cached) { await cached.initialize(); return cached; }
    const row = await (await this.connection()).read<AgentSessionRecord | null>({ command: "find", address: { archived: false, category, session_id } });
    if (!row) throw new Error("session_not_found");
    const storage = this.view(row);
    this.sessions.set(key, storage);
    return storage;
  }

  /** 活动读取绝不回落归档；归档消费方必须显式使用 read_archived_session。 */
  async read_session(session_id: string, category: string) {
    const lease = await this.read_connection();
    const row = await lease.read<AgentSessionRecord | null>({ command: "find", address: { archived: false, category, session_id } });
    if (!row) throw new Error("session_not_found");
    return agent_session_read_view(lease, this.options.agent_id, row);
  }

  /** 有界批量精确读取；独立读租约不创建缺失数据库。 */
  async read_metadata(addresses: readonly import("@/types/agent/SessionMetadata.js").SessionMetadataAddress[]) {
    if (addresses.length > 100) throw new Error("session_metadata_limit_invalid");
    if (!addresses.length) return [];
    const rows = await (await this.read_connection()).read<(AgentSessionRecord | null)[]>({ command: "metadata", addresses });
    return rows.map(row => row ? { session_id: row.session_id, archived: Boolean(row.archived),
      metadata: project_agent_session_metadata(this.options.agent_id, row) } : null);
  }

  async read_archived_session(session_id: string) {
    const lease = await this.read_connection();
    const row = await lease.read<AgentSessionRecord | null>({ command: "find", address: { archived: true, session_id } });
    if (!row) throw new Error("session_not_found");
    return agent_session_read_view(lease, this.options.agent_id, row);
  }

  async has_session(session_id: string, category = "work"): Promise<boolean> {
    if (this.sessions.has(this.key(session_id, category))) return true;
    try {
      return Boolean(await (await this.connection()).read({ command: "find", address: { archived: false, category, session_id } }));
    } catch (error) {
      if (error instanceof Error && error.message === "session_storage_not_found") return false;
      throw error;
    }
  }

  async remove_session(session_id: string, category = "work"): Promise<boolean> {
    const result = await (await this.connection()).write<{ removed: boolean }>("collection", {
      command: "remove", operation_id: random_uuid(), address: { archived: false, category, session_id },
    });
    await this.sessions.get(this.key(session_id, category))?.dispose();
    this.sessions.delete(this.key(session_id, category));
    return result.removed;
  }

  async clear_session_messages(session_id: string, category = "work"): Promise<boolean> {
    if (!(await this.has_session(session_id, category))) return false;
    await (await this.open_session(session_id, category)).clear_messages(); return true;
  }

  async list_sessions(input: AgentListSessionsInput | undefined, executing_session_ids: ReadonlySet<string>): Promise<AgentSessionSummaryPage> {
    return await this.list(input, false, executing_session_ids);
  }
  async list_archived_sessions(input?: AgentArchiveSessionsInput): Promise<AgentArchiveSessionsResult> {
    return await this.list(input, true, new Set());
  }
  async read_archive_plan(operation_id: string): Promise<import("@/types/store/AgentArchivePlan.js").AgentArchivePlan | null> {
    return await (await this.read_connection()).read({ command: "archive_plan", operation_id });
  }
  async prepare_archive(input: import("@/types/store/AgentArchivePlan.js").AgentArchivePlanInput) {
    const lease = await this.connection();
    await lease.write("collection", { command: "archive_prepare", input });
    return (await lease.read<import("@/types/store/AgentArchivePlan.js").AgentArchivePlan>({ command: "archive_plan", operation_id: input.operation_id }));
  }
  async commit_archive_node(input: import("@/types/store/AgentArchivePlan.js").AgentArchiveNodeCommit) {
    const lease = await this.connection();
    await lease.write("collection", { command: "archive_node", input });
    const plan = await lease.read<import("@/types/store/AgentArchivePlan.js").AgentArchivePlan>({ command: "archive_plan", operation_id: input.operation_id });
    const node = plan.nodes.find(node => node.position === input.position)!;
    const key = this.key(node.session_id, node.category);
    const cached = this.sessions.get(key);
    if (cached) { await cached.dispose(); this.sessions.delete(key); }
    return plan;
  }

  async archive_session(session_id: string, category = "work"): Promise<AgentArchiveSessionResult> {
    const archived_at = Date.now();
    await (await this.connection()).write("collection", { command: "archive", operation_id: random_uuid(),
      address: { archived: false, category, session_id }, archived_at });
    await this.sessions.get(this.key(session_id, category))?.dispose();
    this.sessions.delete(this.key(session_id, category));
    return { session_id, archived_at, changed: true };
  }

  async clean_archive(): Promise<AgentCleanArchiveResult> {
    const lease = await this.connection();
    const records = await lease.read<AgentSessionRecord[]>({ command: "archived_records" });
    const removed_session_ids: string[] = [];
    for (const record of records) {
      await lease.write(record.session_id, { command: "remove", operation_id: random_uuid(), address: { archived: true, session_id: record.session_id } });
      removed_session_ids.push(record.session_id);
    }
    return { removed_session_ids };
  }

  async list_pending_interactions(): Promise<AgentInteraction[]> {
    const lease = await this.connection();
    let records: AgentSessionRecord[];
    try { records = await lease.read<AgentSessionRecord[]>({ command: "pending_records" }); }
    catch (error) {
      if (error instanceof Error && error.message === "session_storage_not_found") return [];
      throw error;
    }
    const result: AgentInteraction[] = [];
    for (const record of records) {
      const storage = this.view(record);
      const interactions = collect_pending_interactions(await storage.list_recoverable_agent_messages());
      result.push(...interactions.map(interaction => project_agent_interaction(record.session_id, record.category, interaction, false, storage.origin)));
    }
    return result;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([...this.sessions.values()].map(storage => storage.dispose()));
    this.sessions.clear();
    await Promise.all([this.lease, this.reader].filter(Boolean).map(async lease => await (await lease!).release()));
  }

  private view(row: AgentSessionRecord): AgentSessionStorage {
    return new AgentSessionStorage({ ...this.options, session_id: row.session_id,
      origin: restore_session_origin(JSON.parse(row.origin), row.category), workspace_id: row.workspace_id ?? undefined,
      record: row, lease: {
        read: async (operation, signal) => await (await this.connection()).read(operation, signal),
        write: async (session, operation, settings) => await (await this.connection()).write(session, operation, settings),
        release: async () => {},
      } });
  }

  private async list(input: AgentListSessionsInput | AgentArchiveSessionsInput | undefined, archived: boolean, executing: ReadonlySet<string>): Promise<AgentSessionSummaryPage> {
    let page: AgentSessionRecordPage;
    try {
      page = await (await this.connection()).read<AgentSessionRecordPage>({ command: "list", input: {
        ...input, category: input?.category ?? "work", archived,
      } });
    } catch (error) {
      if (error instanceof Error && error.message === "session_storage_not_found") return { items: [], total: 0, has_more: false };
      throw error;
    }
    return { ...page, items: page.items.map(row => ({ agent_id: this.options.agent_id, session_id: row.session_id,
      origin: restore_session_origin(JSON.parse(row.origin), row.category),
      message_count: row.message_count, created_at: row.created_at, updated_at: row.updated_at,
      ...(row.workspace_id ? { workspace_id: row.workspace_id } : {}), ...(row.title ? { title: row.title } : {}),
      ...(row.model_label ? { model_label: row.model_label } : {}), ...(row.preview_text ? { preview_text: row.preview_text } : {}),
      executing: executing.has(row.session_id),
    })) };
  }

  private key(session_id: string, category: string): string {
    if (!session_id.trim() || session_id !== session_id.trim()) throw new Error("session_storage_address_invalid");
    return `${normalize_session_origin_category(category)}\u0000${session_id}`;
  }

  /** 浏览者获得独立引用，执行 Store 退出后已有浏览者仍可读取同一内存库。 */
  async acquire_read_lease(): Promise<AgentSessionRuntimeLease> {
    if (this.disposed) throw new Error("session_storage_closed");
    const memory = this.options.database_location.type === "memory";
    const database_path = path.join(this.options.storage_root_path, "sessions.db");
    if (memory) await this.connection();
    else if (!(await this.options.files.path_exists(database_path))) {
      for (const partition of ["sessions", "archived-sessions"]) {
        if (await this.options.files.path_exists(path.join(this.options.storage_root_path, partition))) throw new Error("session_migration_required");
      }
      throw new Error("session_storage_not_found");
    }
    return await acquire_agent_session_storage({ agent_id: this.options.agent_id,
      database_path: memory ? ":memory:" : database_path, memory_scope: this.memory_scope,
      on_diagnostic: this.options.on_diagnostic }, true);
  }

  private read_connection(): Promise<AgentSessionRuntimeLease> {
    if (!this.reader) this.reader = this.acquire_read_lease().catch(error => { this.reader = undefined; throw error; });
    return this.reader;
  }

  async remove_archived_session(session_id: string): Promise<boolean> {
    const result = await (await this.connection()).write<{ removed: boolean }>("collection", {
      command: "remove", operation_id: random_uuid(), address: { archived: true, session_id },
    });
    return result.removed;
  }

  private connection(): Promise<AgentSessionRuntimeLease> {
    if (this.disposed) return Promise.reject(new Error("session_storage_closed"));
    if (!this.lease) this.lease = (async () => {
      const database_path = path.join(this.options.storage_root_path, "sessions.db");
      if (this.options.database_location.type === "file") {
        if (!(await this.options.files.path_exists(database_path))) {
          for (const partition of ["sessions", "archived-sessions"]) {
            if (await this.options.files.path_exists(path.join(this.options.storage_root_path, partition))) {
              throw new Error("session_migration_required");
            }
          }
        }
        await this.options.files.ensure_directory(this.options.storage_root_path);
      }
      return await acquire_agent_session_storage({ agent_id: this.options.agent_id,
        database_path: this.options.database_location.type === "memory" ? ":memory:" : database_path,
        memory_scope: this.memory_scope, allow_create: true, on_diagnostic: this.options.on_diagnostic }, false);
    })().catch(error => { this.lease = undefined; throw error; });
    return this.lease;
  }
}
