/**
 * 不装配 Agent、Workspace、Power 或 Session executor 的公共历史浏览入口。
 * 列表在进程共享 Worker 中读取 SQLite 并构建有界快照；主线程只异步枚举候选。
 * 复用 SDK 路径和 canonical 消息解码；不做目录创建、迁移或修复。
 * immutable 模式需要宿主产品先取得跨进程共享读取租约，且不接受跨调用游标。
 */
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { normalize_session_origin_category } from "@downcity/type";
import type { AgentListSessionsInput, AgentSessionSummaryPage } from "../../types/agent/SessionTypes.js";
import type { SessionReadView } from "../../types/store/SessionReadView.js";
import type { SessionBrowseCandidate, SessionBrowseOperation, SessionBrowseQuery } from "../../types/store/SessionBrowse.js";
import {
  admit_session_browse, clear_session_browse_store, register_session_browse_store,
  request_session_browse,
} from "./SessionBrowseBudget.js";
import { resolve_prompt_request_identity } from "../loop/SessionTurnHandles.js";
import { read_session_completion } from "./AgentPendingReferences.js";
import { decode_model_binding } from "./ModelBindingCodec.js";
import { open_session_read_database } from "./SessionReadDatabase.js";
import { read_file_session_history } from "./SessionHistoryReader.js";
import { get_agent_session_database_path, get_agent_archived_session_database_path, get_agent_sessions_path, get_agent_archived_sessions_path, get_agent_session_categories_path, get_agent_archived_session_categories_path } from "./LocalStorePaths.js";

/** 不需要 SessionStore 生命周期的文件型只读浏览配置。 */
export interface AgentSessionBrowserOptions {
  /** Agent 独占存储 scope 的绝对路径，不是 Workspace 项目路径。 */
  storage_root_path: string;
  /** 读取时必须与数据库记录一致的 Agent 完整 ID。 */
  agent_id: string;
  /** 调用方持有离线共享读取租约；禁止忽略未恢复的 WAL。 */
  immutable?: boolean;
}

/** 公共浏览入口，拥有独立分页身份与共享浏览 Worker 的只读生命周期引用。 */
export class AgentSessionBrowser {
  /** 分页身份不跨实例复用。 */
  private readonly store_id = randomUUID();
  /** 归档等产品操作应调用 invalidate，禁止返回已失效快照。 */
  private generation = 0;
  /** 同一 browser 一次只建立一个快照，防止异步扫描相互覆盖。 */
  private listing = false;
  /** 释放后禁止重用。 */
  private disposed = false;
  /** 失效、释放或 Worker 故障时立即结算列表，不等待目录 I/O 返回。 */
  private operation?: SessionBrowseOperation;
  /** 注册共享 Worker 所有权但不启动线程；最后一个文件浏览者释放时终止线程。 */
  private readonly release_store = register_session_browse_store();

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

  /** 不迁移旧数据库的模型事实读取；缺表/缺行代表无法重建的旧默认模型。 */
  async model_binding(session_id: string, category: string): Promise<import("../../types/store/SessionModelBinding.js").SessionModelBinding | undefined> {
    const view = await this.get(session_id, category);
    const database_path = view.archived ? get_agent_archived_session_database_path(this.options.storage_root_path, category, session_id) : get_agent_session_database_path(this.options.storage_root_path, category, session_id);
    const database = open_session_read_database(database_path, this.options.immutable);
    try {
      if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_model_binding'").get()) return undefined;
      const row = database.prepare("SELECT binding FROM session_model_binding WHERE singleton_id = 1").get();
      return row ? decode_model_binding(String(row.binding)) : undefined;
    } finally { database.close(); }
  }

  /** request_id 核对 canonical 接收事实与权威完成日志；不依赖远程 pending handle。 */
  async receipt(session_id: string, category: string, request_id: string) {
    const view = await this.get(session_id, category);
    const identity = resolve_prompt_request_identity(session_id, request_id);
    if (!identity) throw new Error("session_validation_error: request_id is required");
    const database_path = view.archived ? get_agent_archived_session_database_path(this.options.storage_root_path, category, session_id) : get_agent_session_database_path(this.options.storage_root_path, category, session_id);
    const database = open_session_read_database(database_path, this.options.immutable);
    let turn_id: string | undefined;
    try {
      const row = database.prepare("SELECT turn_id, meta FROM messages WHERE message_id = ? AND role = 'user'").get(identity.message_id);
      if (!row) return { accepted: false, completed: false, turn_id: null, result: null, execution_state: "not_found" };
      const meta = row.meta ? JSON.parse(String(row.meta)) : null;
      if (meta?.from?.kind !== "user" || meta.from.user_id !== "local") throw new Error("session_request_forbidden: request_id belongs to another actor");
      turn_id = typeof row.turn_id === "string" ? row.turn_id : undefined;
    } finally { database.close(); }
    const completion = turn_id ? await read_session_completion(this.options.storage_root_path, session_id, turn_id) : undefined;
    return { accepted: true, completed: !!completion, turn_id: turn_id ?? null, result: completion ? { turn_id, ...completion.event.result } : null, execution_state: completion ? "completed" : "accepted" };
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
    let failure: Error | undefined;
    let reject_cancel!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { reject_cancel = reject; });
    const operation: SessionBrowseOperation = {
      reject: (error) => { failure ??= error; reject_cancel(error); },
    };
    const release = admit_session_browse(true, operation.reject);
    this.listing = true;
    this.operation = operation;
    const timer = setTimeout(() => {
      const error = new Error("session_list_timeout: Browse operation exceeded two minutes");
      operation.reject(error);
      clear_session_browse_store(this.store_id, error);
    }, 120_000);
    const check = () => {
      if (failure) throw failure;
      this.assert_available();
      if (query.generation !== this.generation) throw new Error("session_list_cursor_expired: Storage changed while browsing");
    };
    const work = async (): Promise<AgentSessionSummaryPage> => {
      check();
      let page: AgentSessionSummaryPage | undefined;
      if (input.cursor) {
        page = (await request_session_browse({ action: "page", query, limit, cursor: input.cursor })).page;
      } else {
        await request_session_browse({ action: "begin", query, limit });
        check();
        for await (const candidates of enumerate_candidates(this.options.storage_root_path, query, check)) {
          check();
          await request_session_browse({
            action: "batch", query, limit, candidates,
            read_options: { immutable: this.options.immutable, strict: true },
          });
          check();
        }
        check();
        page = (await request_session_browse({ action: "finish", query, limit })).page;
      }
      check();
      if (!page) throw new Error("session_list_worker_failed: Missing page result");
      return this.options.immutable ? { ...page, next_cursor: undefined } : page;
    };
    try {
      return await Promise.race([work(), cancelled]);
    } catch (error) {
      // 翻页失败不丢弃既有快照；旧世代扫描不得清理新世代状态。
      if (!input.cursor && query.generation === this.generation) {
        clear_session_browse_store(this.store_id, error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    } finally {
      clearTimeout(timer);
      release();
      this.operation = undefined;
      this.listing = false;
    }
  }

  /** 破坏性存储操作前调用，使已有快照和进行中扫描失效。 */
  invalidate(): void {
    this.generation += 1;
    const error = new Error("session_list_cursor_expired: Storage changed while browsing");
    this.operation?.reject(error);
    clear_session_browse_store(this.store_id, error);
  }

  /** 取消列表并释放分页缓存与共享 Worker 引用，不删除任何数据。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operation?.reject(new Error("session_list_disposed: Browser is disposed"));
    this.invalidate();
    void this.release_store();
  }

  private assert_available(): void {
    if (this.disposed) throw new Error("session_list_disposed: Browser is disposed");
  }
}

/** 候选最多 32 条、256 KiB；每批确认后继续枚举，取消后不再发送旧世代候选。 */
async function* enumerate_candidates(
  storage_root_path: string,
  query: SessionBrowseQuery,
  check: () => void,
): AsyncGenerator<SessionBrowseCandidate[]> {
  const partition_path = query.archived
    ? get_agent_archived_sessions_path(storage_root_path, query.category)
    : get_agent_sessions_path(storage_root_path, query.category);
  const entries = await fs.readdir(partition_path, { withFileTypes: true }).catch((error: unknown) => {
    if (is_missing(error)) return [];
    throw error;
  });
  check();
  let batch: SessionBrowseCandidate[] = [];
  let bytes = 0;
  for (const entry of entries) {
    check();
    if (!entry.isDirectory()) continue;
    let session_id: string;
    try { session_id = decodeURIComponent(entry.name); } catch { continue; }
    const database_path = query.archived
      ? get_agent_archived_session_database_path(storage_root_path, query.category, session_id)
      : get_agent_session_database_path(storage_root_path, query.category, session_id);
    const exists = await path_exists(database_path);
    check();
    if (!exists) continue;
    const candidate = { database_path, session_id };
    const size = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    if (size > 256 * 1024) throw new Error("session_list_candidate_too_large: Candidate exceeds 256 KiB");
    if (batch.length && (batch.length >= 32 || bytes + size > 256 * 1024)) {
      yield batch;
      check();
      batch = [];
      bytes = 0;
    }
    batch.push(candidate);
    bytes += size;
  }
  if (batch.length) yield batch;
}

/** 不存在可省略；权限和其他 I/O 错误保持可见。 */
function is_missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

/** 查询文件是否存在，不修改内容或权限。 */
async function path_exists(file_path: string): Promise<boolean> {
  try { return (await fs.stat(file_path)).isFile(); }
  catch (error) { if (is_missing(error)) return false; throw error; }
}
