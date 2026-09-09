/**
 * LocalSessionStore：Agent 的 Session 查询与管理视图。
 *
 * 职责说明（中文）
 * - 统一管理 Session 创建判断、删除、列表、归档与清理。
 * - 缓存稳定的 LocalSessionDataStore，避免同一 Session 重复创建 SQLite Storage。
 * - 使用来源类型建立确定性一级分区，避免跨来源扫描。
 */

import { isDeepStrictEqual } from "node:util";
import type {
  AgentArchiveSessionResult,
  AgentArchiveSessionsInput,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentListSessionsInput,
  AgentSessionSummary,
  AgentSessionSummaryPage,
} from "@/types/agent/SessionTypes.js";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import { LocalSessionDataStore } from "@/session/storage/LocalSessionDataStore.js";
import {
  get_agent_archived_session_database_path,
  get_agent_archived_session_origins_path,
  get_agent_archived_session_path,
  get_agent_archived_sessions_path,
  get_agent_session_database_path,
  get_agent_session_path,
} from "@/session/storage/LocalStorePaths.js";
import {
  build_session_info,
  list_archived_agent_session_summary_page,
  list_agent_session_summary_page,
  read_session_metadata_from_database,
} from "@/session/browse/Browse.js";
import type { FileSystem } from "@downcity/type";
import type { LocalSessionStoreOptions } from "@/types/store/LocalStore.js";
import type { SessionOrigin } from "@downcity/type";
import { normalize_session_origin, normalize_session_origin_type } from "@downcity/type";

/** 解码目录中经过 URL 编码的 Session 标识。 */
function decode_session_id(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

/** 默认本地 Agent Store。 */
export class LocalSessionStore implements SessionStore {
  /** 当前 Agent 内部数据文件能力。 */
  private readonly files: FileSystem;

  /** 当前 Agent 的稳定标识。 */
  private readonly agent_id: string;

  /** 当前 Workspace 的稳定标识。 */
  private readonly workspace_id?: string;

  /** 当前 Agent 内部数据根路径。 */
  private readonly storage_root_path: string;

  /** Session 数据库使用本地文件还是进程内存。 */
  private readonly database_location: LocalSessionStoreOptions["database_location"];

  /** 已创建的 Session Store 缓存。 */
  private readonly sessions = new Map<string, LocalSessionDataStore>();

  /** 内存模式中已归档但仍由 Store 持有的 Session。 */
  private readonly archived_sessions = new Map<string, LocalSessionDataStore>();

  constructor(options: LocalSessionStoreOptions) {
    this.files = options.files;
    this.agent_id = options.agent_id;
    this.workspace_id = options.workspace_id;
    this.storage_root_path = options.storage_root_path;
    this.database_location = options.database_location;
  }

  /** 返回指定 Session 的稳定持久化视图。 */
  session(
    session_id: string,
    origin: SessionOrigin,
    workspace_id = this.workspace_id,
  ): SessionStorage {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) {
      throw new Error("SessionStore.session requires a non-empty session_id");
    }
    const resolved_origin = normalize_session_origin(origin);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_origin.type);
    const cached = this.sessions.get(cache_key);
    if (cached) {
      if (isDeepStrictEqual(cached.origin, resolved_origin)) return cached;
      if (Object.keys(resolved_origin).length === 1) return cached;
      if (Object.keys(cached.origin).length > 1) {
        throw new Error(`Session "${resolved_session_id}" origin is immutable`);
      }
    }
    const created = new LocalSessionDataStore({
      files: this.files,
      storage_root_path: this.storage_root_path,
      agent_id: this.agent_id,
      database_location: this.database_location,
      workspace_id: workspace_id,
      session_id: resolved_session_id,
      origin: resolved_origin,
    });
    this.sessions.set(cache_key, created);
    return created;
  }

  /** 判断活动 Session 是否存在。 */
  async has_session(session_id: string, origin_type = "chat"): Promise<boolean> {
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    const cache_key = this.session_cache_key(session_id, resolved_origin_type);
    if (this.database_location.type === "memory") return this.sessions.has(cache_key);
    const database_path = get_agent_session_database_path(
      this.storage_root_path,
      resolved_origin_type,
      session_id,
    );
    if (!(await this.files.path_exists(database_path))) return false;
    await this.assert_session_owner(session_id, resolved_origin_type, false);
    return true;
  }

  /** 永久删除活动 Session。 */
  async remove_session(session_id: string, origin_type = "chat"): Promise<boolean> {
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    const session_path = this.session_path(session_id, resolved_origin_type);
    const cache_key = this.session_cache_key(session_id, resolved_origin_type);
    const cached = this.sessions.get(cache_key);
    const existed = this.database_location.type === "memory"
      ? Boolean(cached)
      : await this.files.path_exists(get_agent_session_database_path(
          this.storage_root_path,
          resolved_origin_type,
          session_id,
        ));
    if (existed) {
      await this.assert_session_owner(session_id, resolved_origin_type, false);
      await cached?.dispose();
      await this.files.remove_path(session_path);
    }
    this.sessions.delete(cache_key);
    return existed;
  }

  /** 清空活动 Session Message 数据。 */
  async clear_session_messages(session_id: string, origin_type = "chat"): Promise<boolean> {
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    if (!(await this.has_session(session_id, resolved_origin_type))) return false;
    const storage = this.session(session_id, { type: resolved_origin_type });
    await storage.clear_messages();
    return true;
  }

  /** 返回活动 Session 摘要页。 */
  async list_sessions(
    input: AgentListSessionsInput | undefined,
    executing_session_ids: ReadonlySet<string>,
  ): Promise<AgentSessionSummaryPage> {
    if (this.database_location.type === "memory") {
      return await this.list_cached_sessions(input, executing_session_ids);
    }
    return await list_agent_session_summary_page({
      project_root: this.storage_root_path,
      agent_id: this.agent_id,
      ...(this.workspace_id || input?.workspace_id ? { workspace_id: this.workspace_id || input?.workspace_id } : {}),
      input,
      executing_session_ids,
      files: this.files,
    });
  }

  /** 将活动 Session 迁入归档区。 */
  async archive_session(session_id: string, origin_type = "chat"): Promise<AgentArchiveSessionResult> {
    const resolved_origin_type = normalize_session_origin_type(origin_type);
    const cache_key = this.session_cache_key(session_id, resolved_origin_type);
    if (this.database_location.type === "memory") {
      const storage = this.sessions.get(cache_key);
      if (!storage) throw new Error(`Session "${session_id}" not found`);
      if (this.archived_sessions.has(cache_key)) {
        throw new Error(`Archived session "${session_id}" already exists`);
      }
      this.sessions.delete(cache_key);
      this.archived_sessions.set(cache_key, storage);
      return { session_id, archived_at: Date.now() };
    }
    const source_path = this.session_path(session_id, resolved_origin_type);
    if (!(await this.files.path_exists(source_path))) {
      throw new Error(`Session "${session_id}" not found`);
    }
    await this.assert_session_owner(session_id, resolved_origin_type, false);
    await this.sessions.get(cache_key)?.dispose();
    const target_path = get_agent_archived_session_path(
      this.storage_root_path,
      resolved_origin_type,
      session_id,
    );
    if (await this.files.path_exists(target_path)) {
      throw new Error(`Archived session "${session_id}" already exists`);
    }
    await this.files.ensure_directory(get_agent_archived_sessions_path(
      this.storage_root_path,
      resolved_origin_type,
    ));
    await this.files.move_path(source_path, target_path);
    this.sessions.delete(cache_key);
    return {
      session_id: session_id,
      archived_at: Date.now(),
    };
  }

  /** 返回归档 Session 摘要页。 */
  async list_archived_sessions(
    input?: AgentArchiveSessionsInput,
  ): Promise<AgentArchiveSessionsResult> {
    if (this.database_location.type === "memory") {
      return await this.list_cached_sessions(input, new Set(), this.archived_sessions);
    }
    return await list_archived_agent_session_summary_page({
      project_root: this.storage_root_path,
      agent_id: this.agent_id,
      ...(this.workspace_id || input?.workspace_id ? { workspace_id: this.workspace_id || input?.workspace_id } : {}),
      input,
      files: this.files,
    });
  }

  /** 永久删除全部归档 Session。 */
  async clean_archive(): Promise<AgentCleanArchiveResult> {
    if (this.database_location.type === "memory") {
      const archived = [...this.archived_sessions.values()];
      this.archived_sessions.clear();
      await Promise.all(archived.map(async (storage) => await storage.dispose()));
      return { removed_session_ids: archived.map((storage) => storage.session_id) };
    }
    const archive_root_path = get_agent_archived_session_origins_path(this.storage_root_path);
    if (!(await this.files.path_exists(archive_root_path))) {
      return { removed_session_ids: [] };
    }
    const removed_session_ids: string[] = [];
    const origin_entries = await this.files.read_directory(archive_root_path);
    for (const origin_entry of origin_entries) {
      if (!origin_entry.is_directory) continue;
      const origin_type = decode_session_id(origin_entry.name);
      if (!origin_type) continue;
      const sessions_path = get_agent_archived_sessions_path(this.storage_root_path, origin_type);
      const session_entries = await this.files.read_directory(sessions_path);
      for (const session_entry of session_entries) {
        if (!session_entry.is_directory) continue;
        const session_id = decode_session_id(session_entry.name);
        if (!session_id) continue;
        if (!(await this.is_session_owner(session_id, origin_type, true))) continue;
        await this.files.remove_path(get_agent_archived_session_path(
          this.storage_root_path,
          origin_type,
          session_id,
        ));
        removed_session_ids.push(session_id);
      }
    }
    return { removed_session_ids: removed_session_ids };
  }

  /** 关闭全部 Session SQLite 连接并清空缓存。 */
  async dispose(): Promise<void> {
    const storages = [...this.sessions.values(), ...this.archived_sessions.values()];
    this.sessions.clear();
    this.archived_sessions.clear();
    await Promise.all(storages.map(async (storage) => await storage.dispose()));
  }

  /** 返回活动 Session 物理目录，仅供本地实现内部使用。 */
  private session_path(session_id: string, origin_type: string): string {
    return get_agent_session_path(
      this.storage_root_path,
      origin_type,
      session_id,
    );
  }

  /** 校验目标 Session 确实属于当前 Agent 与 Workspace。 */
  private async assert_session_owner(
    session_id: string,
    origin_type: string,
    archived: boolean,
  ): Promise<void> {
    if (await this.is_session_owner(session_id, origin_type, archived)) return;
    throw new Error(
      `Session "${session_id}" belongs to another Agent`,
    );
  }

  /** 判断 Session metadata 是否匹配当前查询视图。 */
  private async is_session_owner(
    session_id: string,
    origin_type: string,
    archived: boolean,
  ): Promise<boolean> {
    const cache_key = this.session_cache_key(session_id, origin_type);
    if (this.database_location.type === "memory") {
      const cached = (archived ? this.archived_sessions : this.sessions).get(cache_key);
      if (cached) {
        try {
          const metadata = await cached.read_metadata();
          return metadata.agent_id === this.agent_id && metadata.origin.type === origin_type;
        } catch {
          return false;
        }
      }
      return false;
    }
    const file_path = archived
      ? get_agent_archived_session_database_path(
        this.storage_root_path,
        origin_type,
        session_id,
      )
      : get_agent_session_database_path(this.storage_root_path, origin_type, session_id);
    if (!(await this.files.path_exists(file_path))) return false;
    const metadata = read_session_metadata_from_database(file_path, origin_type);
    return metadata?.agent_id === this.agent_id && metadata.origin.type === origin_type;
  }

  /** 从内存数据库缓存投影 Session 列表。 */
  private async list_cached_sessions(
    input: AgentListSessionsInput | AgentArchiveSessionsInput | undefined,
    executing_session_ids: ReadonlySet<string>,
    storages = this.sessions,
  ): Promise<AgentSessionSummaryPage> {
    const origin_type = normalize_session_origin_type(input?.origin_type ?? "chat");
    const query = String(input?.query || "").trim().toLowerCase();
    const summaries: AgentSessionSummary[] = [];
    for (const storage of storages.values()) {
      if (storage.origin.type !== origin_type) continue;
      const metadata = await storage.read_metadata();
      if ((this.workspace_id || input?.workspace_id) &&
          metadata.workspace_id !== (this.workspace_id || input?.workspace_id)) continue;
      const summary = build_session_info({
        project_root: this.storage_root_path,
        agent_id: this.agent_id,
        session_id: storage.session_id,
        metadata,
        executing: executing_session_ids.has(storage.session_id),
      });
      if (query && ![
        summary.session_id,
        summary.title || "",
        summary.preview_text || "",
      ].join("\n").toLowerCase().includes(query)) continue;
      summaries.push(summary);
    }
    summaries.sort((left, right) => (right.updated_at || 0) - (left.updated_at || 0));
    const cursor = Math.max(0, Number(input?.cursor) || 0);
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 500);
    const items = summaries.slice(cursor, cursor + limit);
    const next_cursor = cursor + items.length;
    return {
      items,
      total: summaries.length,
      ...(next_cursor < summaries.length ? { next_cursor: String(next_cursor) } : {}),
      has_more: next_cursor < summaries.length,
    };
  }

  /** 返回来源分区内唯一的 Session Store 缓存键。 */
  private session_cache_key(session_id: string, origin_type: string): string {
    return `${origin_type}\u0000${session_id}`;
  }
}
