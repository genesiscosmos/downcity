/**
 * LocalSessionStore：Agent 的 Session 查询与管理视图。
 *
 * 职责说明（中文）
 * - 统一管理 Session 创建判断、删除、列表、归档与清理。
 * - 缓存稳定的 LocalSessionDataStore，避免同一 Session 重复创建 SQLite Storage。
 * - 使用来源类型建立确定性一级分区，避免跨来源扫描。
 */

import { isDeepStrictEqual } from "node:util";
import type { SessionReadView } from "@/types/store/SessionReadView.js";
import { create_session_read_view, read_file_session_history } from "./SessionHistoryReader.js";
import { normalize_session_id } from "@/session/SessionIdentity.js";
import type {
  AgentArchiveSessionResult,
  AgentArchiveSessionsInput,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentListSessionsInput,
  AgentSessionSummaryPage,
} from "@/types/agent/SessionTypes.js";
import type { SessionStore } from "@/types/store/SessionStore.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import { LocalSessionDataStore } from "@/session/storage/LocalSessionDataStore.js";
import {
  get_agent_archived_session_database_path,
  get_agent_archived_session_categories_path,
  get_agent_archived_session_path,
  get_agent_archived_sessions_path,
  get_agent_session_database_path,
  get_agent_session_path,
} from "@/session/storage/LocalStorePaths.js";
import {
  read_session_metadata_from_database,
} from "@/session/storage/Browse.js";
import type { FileSystem } from "@downcity/type";
import type { SessionBrowseBaseInput } from "@/types/store/SessionBrowse.js";
import { SessionBrowseClient } from "./SessionBrowseClient.js";
import type { LocalSessionStoreOptions } from "@/types/store/LocalStore.js";
import type { SessionOrigin } from "@downcity/type";
import { migrate_session_origin_categories } from "@/session/storage/OriginCategoryMigration.js";
import { normalize_session_origin, normalize_session_origin_category, SESSION_ORIGIN_CATEGORY_WORK } from "@downcity/type";

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

  /**
   * 来源分类迁移的唯一执行入口。
   *
   * 懒执行且在实例内只跑一次：所有异步读写路径先经过它，保证迁移完成后
   * 才会按新分区读取历史会话。
   */
  private migration?: Promise<void>;

  /** 列表专用生命周期、世代与共享 Worker 接入。 */
  private readonly browse: SessionBrowseClient;

  constructor(options: LocalSessionStoreOptions) {
    this.files = options.files;
    this.agent_id = options.agent_id;
    this.workspace_id = options.workspace_id;
    this.storage_root_path = options.storage_root_path;
    this.database_location = options.database_location;
    this.browse = new SessionBrowseClient({
      files: this.files,
      project_root: this.storage_root_path,
      agent_id: this.agent_id,
      ...(this.workspace_id ? { workspace_id: this.workspace_id } : {}),
      memory: this.database_location.type === "memory",
    });
  }

  /** 保证历史数据已完成来源分类迁移；失败时释放缓存以便下次重试。 */
  private async ensure_origin_categories_migrated(): Promise<void> {
    if (this.database_location.type === "memory") return;
    this.migration ??= migrate_session_origin_categories({
      files: this.files,
      storage_root_path: this.storage_root_path,
    }).then(() => undefined).catch((error: unknown) => {
      // 失败不留半成品状态：下次调用重新扫描，已迁移的会话靠自身幂等跳过。
      this.migration = undefined;
      throw error;
    });
    await this.migration;
  }

  /** 为新 Session 创建稳定持久化视图。 */
  create_session(
    session_id: string,
    origin: SessionOrigin,
    workspace_id = this.workspace_id,
  ): SessionStorage {
    const resolved_session_id = normalize_session_id(session_id);
    if (!resolved_session_id) {
      throw new Error("SessionStore.create_session requires a non-empty session_id");
    }
    const resolved_origin = normalize_session_origin(origin);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_origin.category);
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

  /** 打开已有 Session，并以数据库中的完整 origin 作为唯一事实。 */
  async open_session(session_id: string, category = SESSION_ORIGIN_CATEGORY_WORK): Promise<SessionStorage> {
    await this.ensure_origin_categories_migrated();
    const resolved_session_id = normalize_session_id(session_id);
    if (!resolved_session_id) {
      throw new Error("SessionStore.open_session requires a non-empty session_id");
    }
    const resolved_category = normalize_session_origin_category(category);
    const cache_key = this.session_cache_key(resolved_session_id, resolved_category);
    const cached = this.sessions.get(cache_key);
    if (cached) return cached;
    if (this.database_location.type === "memory") {
      throw new Error(`Session "${resolved_session_id}" not found`);
    }
    const database_path = get_agent_session_database_path(
      this.storage_root_path,
      resolved_category,
      resolved_session_id,
    );
    if (!(await this.files.path_exists(database_path))) {
      throw new Error(`Session "${resolved_session_id}" not found`);
    }
    const metadata = read_session_metadata_from_database(database_path, resolved_category);
    if (!metadata || metadata.agent_id !== this.agent_id) {
      throw new Error(`Session "${resolved_session_id}" belongs to another Agent`);
    }
    const opened = new LocalSessionDataStore({
      files: this.files,
      storage_root_path: this.storage_root_path,
      agent_id: this.agent_id,
      database_location: this.database_location,
      ...(metadata.workspace_id ? { workspace_id: metadata.workspace_id } : {}),
      session_id: resolved_session_id,
      origin: metadata.origin,
    });
    this.sessions.set(cache_key, opened);
    return opened;
  }

  /** 只读查询已有活动或归档历史，禁止触发来源迁移或 Session 初始化。 */
  async read_session(session_id: string, category: string): Promise<SessionReadView> {
    const resolved_id = normalize_session_id(session_id);
    const resolved_category = normalize_session_origin_category(category);
    if (!resolved_id) throw new Error("Session id is required");
    if (this.database_location.type === "memory") {
      const key = this.session_cache_key(resolved_id, resolved_category);
      const active = this.sessions.get(key);
      const storage = active ?? this.archived_sessions.get(key);
      if (!storage) throw new Error("session_target_forbidden: Session is unavailable to this Agent");
      const metadata = await storage.read_metadata();
      if (metadata.agent_id !== this.agent_id || metadata.origin.category !== resolved_category) {
        throw new Error("session_target_forbidden: Session is unavailable to this Agent");
      }
      return create_session_read_view(metadata, !active, storage);
    }
    const active_path = get_agent_session_database_path(this.storage_root_path, resolved_category, resolved_id);
    const archived = !(await this.files.path_exists(active_path));
    const database_path = archived
      ? get_agent_archived_session_database_path(this.storage_root_path, resolved_category, resolved_id)
      : active_path;
    if (!(await this.files.path_exists(database_path))) {
      throw new Error("session_target_forbidden: Session is unavailable to this Agent");
    }
    return read_file_session_history(database_path, this.agent_id, resolved_id, resolved_category, archived);
  }

  /** 判断活动 Session 是否存在。 */
  async has_session(session_id: string, category = SESSION_ORIGIN_CATEGORY_WORK): Promise<boolean> {
    await this.ensure_origin_categories_migrated();
    const resolved_category = normalize_session_origin_category(category);
    const cache_key = this.session_cache_key(session_id, resolved_category);
    if (this.database_location.type === "memory") return this.sessions.has(cache_key);
    const database_path = get_agent_session_database_path(
      this.storage_root_path,
      resolved_category,
      session_id,
    );
    if (!(await this.files.path_exists(database_path))) return false;
    await this.assert_session_owner(session_id, resolved_category, false);
    return true;
  }

  /** 永久删除活动 Session。 */
  async remove_session(session_id: string, category = SESSION_ORIGIN_CATEGORY_WORK): Promise<boolean> {
    return await this.browse.mutate(() => this.remove_session_data(session_id, category));
  }

  /** 执行永久删除；外层浏览世代覆盖所有异步阶段。 */
  private async remove_session_data(session_id: string, category: string): Promise<boolean> {
    await this.ensure_origin_categories_migrated();
    const resolved_category = normalize_session_origin_category(category);
    const session_path = this.session_path(session_id, resolved_category);
    const cache_key = this.session_cache_key(session_id, resolved_category);
    const cached = this.sessions.get(cache_key);
    const existed = this.database_location.type === "memory"
      ? Boolean(cached)
      : await this.files.path_exists(get_agent_session_database_path(
          this.storage_root_path,
          resolved_category,
          session_id,
        ));
    if (existed) {
      await this.assert_session_owner(session_id, resolved_category, false);
      await cached?.dispose();
      await this.files.remove_path(session_path);
    }
    this.sessions.delete(cache_key);
    return existed;
  }

  /** 清空活动 Session Message 数据。 */
  async clear_session_messages(session_id: string, category = SESSION_ORIGIN_CATEGORY_WORK): Promise<boolean> {
    return await this.browse.mutate(() => this.clear_session_message_data(session_id, category));
  }

  /** 执行消息清空。 */
  private async clear_session_message_data(session_id: string, category: string): Promise<boolean> {
    await this.ensure_origin_categories_migrated();
    const resolved_category = normalize_session_origin_category(category);
    if (!(await this.has_session(session_id, resolved_category))) return false;
    const storage = await this.open_session(session_id, resolved_category);
    await storage.clear_messages();
    return true;
  }

  /** 返回活动 Session 摘要页。 */
  async list_sessions(
    input: AgentListSessionsInput | undefined,
    executing_session_ids: ReadonlySet<string>,
  ): Promise<AgentSessionSummaryPage> {
    return await this.browse.list(
      input, false, executing_session_ids,
      () => this.cached_session_projections(this.sessions, input?.category),
      () => this.ensure_origin_categories_migrated(),
    );
  }

  /** 将活动 Session 迁入归档区。 */
  async archive_session(session_id: string, category = SESSION_ORIGIN_CATEGORY_WORK): Promise<AgentArchiveSessionResult> {
    return await this.browse.mutate(() => this.archive_session_data(session_id, category));
  }

  /** 执行活动到归档的移动，内存模式同样受世代保护。 */
  private async archive_session_data(session_id: string, category: string): Promise<AgentArchiveSessionResult> {
    await this.ensure_origin_categories_migrated();
    const resolved_category = normalize_session_origin_category(category);
    const cache_key = this.session_cache_key(session_id, resolved_category);
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
    const source_path = this.session_path(session_id, resolved_category);
    if (!(await this.files.path_exists(source_path))) {
      throw new Error(`Session "${session_id}" not found`);
    }
    await this.assert_session_owner(session_id, resolved_category, false);
    await this.sessions.get(cache_key)?.dispose();
    const target_path = get_agent_archived_session_path(
      this.storage_root_path,
      resolved_category,
      session_id,
    );
    if (await this.files.path_exists(target_path)) {
      throw new Error(`Archived session "${session_id}" already exists`);
    }
    await this.files.ensure_directory(get_agent_archived_sessions_path(
      this.storage_root_path,
      resolved_category,
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
    return await this.browse.list(
      input, true, new Set(),
      () => this.cached_session_projections(this.archived_sessions, input?.category),
      () => this.ensure_origin_categories_migrated(),
    );
  }

  /** 永久删除全部归档 Session。 */
  async clean_archive(): Promise<AgentCleanArchiveResult> {
    return await this.browse.mutate(() => this.clean_archive_data());
  }

  /** 执行归档清理，部分失败仍会失效已有快照。 */
  private async clean_archive_data(): Promise<AgentCleanArchiveResult> {
    await this.ensure_origin_categories_migrated();
    if (this.database_location.type === "memory") {
      const archived = [...this.archived_sessions.values()];
      this.archived_sessions.clear();
      await Promise.all(archived.map(async (storage) => await storage.dispose()));
      return { removed_session_ids: archived.map((storage) => storage.session_id) };
    }
    const archive_root_path = get_agent_archived_session_categories_path(this.storage_root_path);
    if (!(await this.files.path_exists(archive_root_path))) {
      return { removed_session_ids: [] };
    }
    const removed_session_ids: string[] = [];
    const origin_entries = await this.files.read_directory(archive_root_path);
    for (const origin_entry of origin_entries) {
      if (!origin_entry.is_directory) continue;
      const category = decode_session_id(origin_entry.name);
      if (!category) continue;
      const sessions_path = get_agent_archived_sessions_path(this.storage_root_path, category);
      const session_entries = await this.files.read_directory(sessions_path);
      for (const session_entry of session_entries) {
        if (!session_entry.is_directory) continue;
        const session_id = decode_session_id(session_entry.name);
        if (!session_id) continue;
        if (!(await this.is_session_owner(session_id, category, true))) continue;
        await this.files.remove_path(get_agent_archived_session_path(
          this.storage_root_path,
          category,
          session_id,
        ));
        removed_session_ids.push(session_id);
      }
    }
    return { removed_session_ids: removed_session_ids };
  }

  /** 关闭全部 Session SQLite 连接并清空缓存。 */
  async dispose(): Promise<void> {
    const browse_disposal = this.browse.dispose();
    const storages = [...this.sessions.values(), ...this.archived_sessions.values()];
    this.sessions.clear();
    this.archived_sessions.clear();
    await Promise.all([browse_disposal, ...storages.map(async (storage) => await storage.dispose())]);
  }

  /** 返回活动 Session 物理目录，仅供本地实现内部使用。 */
  private session_path(session_id: string, category: string): string {
    return get_agent_session_path(
      this.storage_root_path,
      category,
      session_id,
    );
  }

  /** 校验目标 Session 确实属于当前 Agent 与 Workspace。 */
  private async assert_session_owner(
    session_id: string,
    category: string,
    archived: boolean,
  ): Promise<void> {
    if (await this.is_session_owner(session_id, category, archived)) return;
    throw new Error(
      `Session "${session_id}" belongs to another Agent`,
    );
  }

  /** 判断 Session metadata 是否匹配当前查询视图。 */
  private async is_session_owner(
    session_id: string,
    category: string,
    archived: boolean,
  ): Promise<boolean> {
    const cache_key = this.session_cache_key(session_id, category);
    if (this.database_location.type === "memory") {
      const cached = (archived ? this.archived_sessions : this.sessions).get(cache_key);
      if (cached) {
        try {
          const metadata = await cached.read_metadata();
          return metadata.agent_id === this.agent_id && metadata.origin.category === category;
        } catch {
          return false;
        }
      }
      return false;
    }
    const file_path = archived
      ? get_agent_archived_session_database_path(
        this.storage_root_path,
        category,
        session_id,
      )
      : get_agent_session_database_path(this.storage_root_path, category, session_id);
    if (!(await this.files.path_exists(file_path))) return false;
    const metadata = read_session_metadata_from_database(file_path, category);
    return metadata?.agent_id === this.agent_id && metadata.origin.category === category;
  }

  /** memory 数据库逐条投影；快照层统一负责过滤、预算与分页，不传递给 Worker。 */
  private async *cached_session_projections(
    storages: ReadonlyMap<string, LocalSessionDataStore>,
    category?: string,
  ): AsyncGenerator<SessionBrowseBaseInput> {
    const resolved_category = normalize_session_origin_category(category ?? SESSION_ORIGIN_CATEGORY_WORK);
    for (const storage of storages.values()) {
      if (storage.origin.category !== resolved_category) continue;
      yield {
        project_root: this.storage_root_path,
        agent_id: this.agent_id,
        session_id: storage.session_id,
        metadata: await storage.read_metadata(),
      };
    }
  }

  /** 返回来源分区内唯一的 Session Store 缓存键。 */
  private session_cache_key(session_id: string, category: string): string {
    return `${category}\u0000${normalize_session_id(session_id)}`;
  }
}
