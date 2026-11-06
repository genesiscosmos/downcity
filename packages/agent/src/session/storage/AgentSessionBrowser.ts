/**
 * 不装配 Agent、Workspace、Power 或 Session executor 的公共历史浏览入口。
 * 复用 SDK 路径、canonical 消息解码和有界快照分页；不做目录创建、迁移或修复。
 * immutable 模式需要宿主产品先取得跨进程共享读取租约，且不接受跨调用游标。
 */
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { normalize_session_origin_category } from "@downcity/type";
import type { AgentListSessionsInput, AgentSessionSummaryPage } from "../../types/agent/SessionTypes.js";
import type { SessionReadView } from "../../types/store/SessionReadView.js";
import type { SessionBrowseQuery } from "../../types/store/SessionBrowse.js";
import { SessionBrowseSnapshots } from "./SessionBrowseSnapshots.js";
import { read_session_metadata_from_database } from "./Browse.js";
import { read_file_session_history } from "./SessionHistoryReader.js";
import { get_agent_session_database_path, get_agent_archived_session_database_path, get_agent_sessions_path, get_agent_archived_sessions_path, get_agent_session_categories_path, get_agent_archived_session_categories_path } from "./LocalStorePaths.js";

const snapshots = new SessionBrowseSnapshots(64 * 1024 * 1024);

/** 不需要 SessionStore 生命周期的文件型只读浏览配置。 */
export interface AgentSessionBrowserOptions {
  /** Agent 独占存储 scope 的绝对路径，不是 Workspace 项目路径。 */
  storage_root_path: string;
  /** 读取时必须与数据库记录一致的 Agent 完整 ID。 */
  agent_id: string;
  /** 调用方持有离线共享读取租约；禁止忽略未恢复的 WAL。 */
  immutable?: boolean;
}

/** 公共浏览入口，生命周期只拥有分页快照，不拥有执行资源。 */
export class AgentSessionBrowser {
  /** 分页身份不跨实例复用。 */
  private readonly store_id = randomUUID();
  /** 归档等产品操作应调用 invalidate，禁止返回已失效快照。 */
  private generation = 0;
  /** 同一 browser 一次只建立一个快照，防止异步扫描相互覆盖。 */
  private listing = false;
  /** 释放后禁止重用。 */
  private disposed = false;

  constructor(private readonly options: AgentSessionBrowserOptions) {}

  /** 列举已有分类，不迁移目录；资源删除预检必须覆盖所有执行来源。 */
  async categories(archived = false): Promise<string[]> {
    this.assert_available();
    const root = archived ? get_agent_archived_session_categories_path(this.options.storage_root_path) : get_agent_session_categories_path(this.options.storage_root_path);
    const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => { if (is_missing(error)) return []; throw error; });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => decodeURIComponent(entry.name)).sort();
  }

  /** 活动和归档必须唯一定位；读取不恢复 Session，不改变其 Workspace。 */
  async get(session_id: string, category = "work"): Promise<SessionReadView> {
    this.assert_available();
    if (!session_id || session_id.trim() !== session_id) throw new Error("session_validation_error: A complete Session ID is required");
    const resolved_category = normalize_session_origin_category(category);
    const active_path = get_agent_session_database_path(this.options.storage_root_path, resolved_category, session_id);
    const archived_path = get_agent_archived_session_database_path(this.options.storage_root_path, resolved_category, session_id);
    const [active, archived] = await Promise.all([path_exists(active_path), path_exists(archived_path)]);
    if (active && archived) throw new Error("session_address_conflict: Session exists in both active and archived storage");
    if (!active && !archived) throw new Error("session_not_found: Session does not exist");
    return read_file_session_history(active ? active_path : archived_path, this.options.agent_id, session_id, resolved_category, archived, this.options.immutable);
  }

  /** 列表复用 SDK 的过滤、排序、预算和签名游标，不截页后再过滤。 */
  async list(input: AgentListSessionsInput = {}, archived = false): Promise<AgentSessionSummaryPage> {
    this.assert_available();
    if (this.options.immutable && input.cursor) throw new Error("session_pagination_unavailable: Offline browsing only supports the first page");
    if (this.listing) throw new Error("session_list_busy: A browse operation is already in progress");
    const category = normalize_session_origin_category(input.category ?? "work");
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("session_validation_error: limit must be an integer from 1 to 200");
    const query: SessionBrowseQuery = {
      store_id: this.store_id, generation: this.generation, agent_id: this.options.agent_id,
      category, archived, workspace_id: input.workspace_id ?? "", origin_type: input.origin_type ?? "",
      query: String(input.query ?? "").trim().toLowerCase(),
    };
    if (input.cursor) return snapshots.page(query, input.cursor, limit);
    this.listing = true;
    try {
      snapshots.begin(query);
      const partition_path = archived ? get_agent_archived_sessions_path(this.options.storage_root_path, category) : get_agent_sessions_path(this.options.storage_root_path, category);
      const entries = await fs.readdir(partition_path, { withFileTypes: true }).catch((error: unknown) => {
        if (is_missing(error)) return [];
        throw error;
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        let session_id: string;
        try { session_id = decodeURIComponent(entry.name); } catch { continue; }
        const database_path = archived
          ? get_agent_archived_session_database_path(this.options.storage_root_path, category, session_id)
          : get_agent_session_database_path(this.options.storage_root_path, category, session_id);
        if (!await path_exists(database_path)) continue;
        const metadata = read_session_metadata_from_database(database_path, category, { immutable: this.options.immutable, strict: true });
        if (!metadata) throw new Error("session_schema_invalid: Missing Session state");
        snapshots.append({ project_root: this.options.storage_root_path, agent_id: this.options.agent_id, session_id, metadata }, query);
      }
      this.assert_available();
      if (query.generation !== this.generation) throw new Error("session_list_cursor_expired: Storage changed while browsing");
      const page = snapshots.finish(query, limit);
      return this.options.immutable ? { ...page, next_cursor: undefined } : page;
    } catch (error) { snapshots.clear(this.store_id); throw error; }
    finally { this.listing = false; }
  }

  /** 破坏性存储操作前调用，使已有快照和进行中扫描失效。 */
  invalidate(): void { this.generation += 1; snapshots.clear(this.store_id); }

  /** 只释放分页缓存，不删除任何数据。 */
  dispose(): void { this.disposed = true; this.invalidate(); }

  private assert_available(): void {
    if (this.disposed) throw new Error("session_list_disposed: Browser is disposed");
  }
}

/** 不存在可省略；权限和其他 I/O 错误保持可见。 */
function is_missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

/** 查询文件是否存在，不修改内容或权限。 */
async function path_exists(file_path: string): Promise<boolean> {
  try { return (await fs.stat(file_path)).isFile(); }
  catch (error) { if (is_missing(error)) return false; throw error; }
}
