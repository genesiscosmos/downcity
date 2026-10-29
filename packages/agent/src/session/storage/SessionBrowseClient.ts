/**
 * LocalSessionStore 的列表生命周期边界。
 * 主线程只通过 FileSystem 枚举候选；文件 SQLite 读取、过滤排序和快照均在共享 Worker。
 * 每个 Store 一个执行项、最多 8 个等待项，全部计入进程 64 上限；超时/失效可取消。
 */
import { randomUUID } from "node:crypto";
import { normalize_session_origin_category, SESSION_ORIGIN_CATEGORY_WORK } from "@downcity/type";
import type { AgentListSessionsInput, AgentSessionSummaryPage } from "../../types/agent/SessionTypes.js";
import type {
  SessionBrowseCandidate, SessionBrowseMemorySource, SessionBrowseOperation,
  SessionBrowseOptions, SessionBrowseQuery, SessionBrowseQueueEntry,
} from "../../types/store/SessionBrowse.js";
import {
  get_agent_archived_session_database_path, get_agent_archived_sessions_path,
  get_agent_session_database_path, get_agent_sessions_path,
} from "./LocalStorePaths.js";
import {
  admit_session_browse, clear_session_browse_store, memory_browse_snapshots,
  register_session_browse_store, request_session_browse,
} from "./SessionBrowseBudget.js";
import { session_list_cursor_expired } from "./SessionBrowseSnapshots.js";

/** 独立于 Session 消息数据库连接的浏览状态。 */
export class SessionBrowseClient {
  /** Store 随机身份，禁止同路径的不同实例交换游标。 */
  private readonly store_id = randomUUID();
  /** 删除、归档、清空操作的世代。 */
  private generation = 0;
  /** 进行中的破坏性修改数，修改期间拒绝构建。 */
  private mutations = 0;
  /** 浏览的永久终态。 */
  private disposed = false;
  /** 唯一活动列表的取消入口。 */
  private operation?: SessionBrowseOperation;
  /** 最多 8 个已准入等待项。 */
  private queue: SessionBrowseQueueEntry[] = [];
  /** 唯一串行执行项。 */
  private active_entry?: SessionBrowseQueueEntry;
  /** file Store 注册的幂等释放函数。 */
  private readonly release_store?: () => Promise<void>;
  /** dispose 的稳定完成结果。 */
  private disposal?: Promise<void>;

  constructor(private readonly options: SessionBrowseOptions) {
    if (!options.memory) this.release_store = register_session_browse_store();
  }

  /** 所有破坏性修改前后都推进 generation，覆盖构建中及部分失败的修改。 */
  async mutate<T>(action: () => Promise<T>): Promise<T> {
    this.mutations += 1;
    this.invalidate();
    try {
      return await action();
    } finally {
      this.mutations -= 1;
      this.invalidate();
    }
  }

  /** Store 串行 FIFO：最多等待 8 项，排队加执行总时限两分钟。 */
  async list(
    input: AgentListSessionsInput | undefined,
    archived: boolean,
    executing_session_ids: ReadonlySet<string>,
    memory_source: SessionBrowseMemorySource,
    prepare: () => Promise<void>,
  ): Promise<AgentSessionSummaryPage> {
    this.assert_available();
    if (this.mutations) throw session_list_cursor_expired();
    if (this.active_entry && this.queue.length >= 8) {
      throw new Error("session_list_busy: Store permits one active operation and 8 queued requests");
    }
    return await new Promise<AgentSessionSummaryPage>((resolve, reject) => {
      let settled = false;
      let entry!: SessionBrowseQueueEntry;
      const release = admit_session_browse(!this.options.memory, (error) => entry.cancel(error));
      const finish = () => {
        clearTimeout(timer);
        release();
      };
      const timer = setTimeout(() => {
        entry.cancel(new Error("session_list_timeout: Queue and operation exceeded two minutes"));
      }, 120_000);
      entry = {
        cancelled: false,
        run: () => this.execute_list(input, archived, executing_session_ids, memory_source, prepare),
        resolve: (page) => {
          if (settled) return;
          settled = true;
          finish();
          resolve(page);
        },
        cancel: (error) => {
          if (settled) return;
          settled = true;
          entry.cancelled = true;
          this.queue = this.queue.filter((item) => item !== entry);
          if (this.active_entry === entry) {
            this.operation?.reject(error);
            clear_session_browse_store(this.store_id, error);
          }
          finish();
          reject(error);
        },
      };
      this.queue.push(entry);
      void this.drain();
    });
  }

  /** 唯一 drain 消费 Store 队列，不创建 tail Promise 链。 */
  private async drain(): Promise<void> {
    if (this.active_entry) return;
    let entry: SessionBrowseQueueEntry | undefined;
    while ((entry = this.queue.shift())) {
      if (entry.cancelled) continue;
      this.active_entry = entry;
      try {
        entry.resolve(await entry.run());
      } catch (error) {
        entry.cancel(error instanceof Error ? error : new Error(String(error)));
      } finally {
        this.active_entry = undefined;
      }
    }
  }

  /** 在可取消的操作内完成迁移、扫描和分页，executing 只在返回当前页时覆盖。 */
  private async execute_list(
    input: AgentListSessionsInput | undefined,
    archived: boolean,
    executing_session_ids: ReadonlySet<string>,
    memory_source: SessionBrowseMemorySource,
    prepare: () => Promise<void>,
  ): Promise<AgentSessionSummaryPage> {
    this.assert_available();
    if (this.mutations) throw session_list_cursor_expired();
    const generation = this.generation;
    const query: SessionBrowseQuery = {
      store_id: this.store_id, generation, agent_id: this.options.agent_id,
      category: normalize_session_origin_category(input?.category ?? SESSION_ORIGIN_CATEGORY_WORK),
      archived, workspace_id: this.options.workspace_id || input?.workspace_id || "",
      origin_type: String(input?.origin_type ?? "").trim(),
      query: String(input?.query ?? "").trim().toLowerCase(),
    };
    const raw_limit = Number(input?.limit ?? 50);
    const limit = Number.isFinite(raw_limit) ? Math.max(1, Math.min(500, Math.floor(raw_limit))) : 50;
    let failure: Error | undefined;
    let reject_cancel!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { reject_cancel = reject; });
    const operation: SessionBrowseOperation = {
      reject: (error) => {
        failure ??= error;
        reject_cancel(error);
      },
    };
    this.operation = operation;
    const check = () => {
      if (failure) throw failure;
      this.assert_available();
      if (generation !== this.generation || this.mutations) throw session_list_cursor_expired();
    };
    const work = async (): Promise<AgentSessionSummaryPage> => {
      check();
      let page: AgentSessionSummaryPage;
      if (input?.cursor !== undefined) {
        page = this.options.memory
          ? memory_browse_snapshots.page(query, input.cursor, limit)
          : (await request_session_browse({ action: "page", query, limit, cursor: input.cursor })).page!;
      } else {
        await prepare();
        check();
        if (this.options.memory) {
          memory_browse_snapshots.begin(query);
          for await (const projection of memory_source()) {
            check();
            memory_browse_snapshots.append(projection, query);
          }
          check();
          page = memory_browse_snapshots.finish(query, limit);
        } else {
          await request_session_browse({ action: "begin", query, limit });
          check();
          for await (const candidates of this.enumerate(query, check)) {
            check();
            await request_session_browse({ action: "batch", query, limit, candidates });
            check();
          }
          check();
          page = (await request_session_browse({ action: "finish", query, limit })).page!;
        }
      }
      check();
      if (!page) throw new Error("session_list_worker_failed: Missing page result");
      return {
        ...page,
        items: page.items.map((item) => ({
          ...item, executing: !archived && executing_session_ids.has(item.session_id),
        })),
      };
    };
    try {
      return await Promise.race([work(), cancelled]);
    } catch (error) {
      // 旧世代不得清理新状态；下一队列项只会在本执行项 finally 后启动。
      if (generation === this.generation) {
        clear_session_browse_store(this.store_id, error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    } finally {
      this.operation = undefined;
    }
  }

  /** browse dispose 为终态，重复调用返回同一完成结果。 */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    const error = new Error("session_list_disposed: Store browse is disposed");
    this.cancel_all(error);
    clear_session_browse_store(this.store_id, error);
    this.disposal = this.release_store?.() ?? Promise.resolve();
    return this.disposal;
  }

  /** 世代同步推进，挂起中的 FileSystem await 返回后也不能继续发送候选。 */
  private invalidate(): void {
    this.generation += 1;
    const error = session_list_cursor_expired();
    this.cancel_all(error);
    clear_session_browse_store(this.store_id, error);
  }

  /** 同步拒绝执行项和所有已准入等待项，并归还进程容量。 */
  private cancel_all(error: Error): void {
    this.operation?.reject(error);
    this.active_entry?.cancel(error);
    for (const entry of [...this.queue]) entry.cancel(error);
  }

  /** dispose 后绝不重新获取 Worker。 */
  private assert_available(): void {
    if (this.disposed) throw new Error("session_list_disposed: Store browse is disposed");
  }

  /** 候选批次最多 32 条、256 KiB；每批收到 Worker 确认才继续枚举。 */
  private async *enumerate(
    query: SessionBrowseQuery,
    check: () => void,
  ): AsyncGenerator<SessionBrowseCandidate[]> {
    const root = this.options.project_root;
    const files = this.options.files;
    const sessions_path = query.archived
      ? get_agent_archived_sessions_path(root, query.category)
      : get_agent_sessions_path(root, query.category);
    const exists = await files.path_exists(sessions_path);
    check();
    if (!exists) return;
    // FileSystem 当前返回完整目录项数组；只保留一个数组，不预构建所有数据库候选。
    const entries = await files.read_directory(sessions_path);
    check();
    let batch: SessionBrowseCandidate[] = [];
    let bytes = 0;
    for (const entry of entries) {
      check();
      if (!entry.is_directory) continue;
      let session_id = entry.name;
      try { session_id = decodeURIComponent(entry.name); } catch { /* 保留原目录标识。 */ }
      const database_path = query.archived
        ? get_agent_archived_session_database_path(root, query.category, session_id)
        : get_agent_session_database_path(root, query.category, session_id);
      const database_exists = await files.path_exists(database_path);
      check();
      if (!database_exists) continue;
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
}
