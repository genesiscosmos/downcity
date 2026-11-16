/**
 * 不依赖执行器的 Agent DB 浏览租约。
 * 已初始化集合只走有界只读 Worker；现存空根的首页和分类为空，精确读取仍要求存储。
 * 旧格式、路径和存储错误保持明确失败，浏览不创建缺失的数据库。
 * 内存宿主注入 acquire_read_lease 复用原拥有者，禁止另建独立内存库。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { normalize_session_origin_category } from "@downcity/type";
import type { SessionMessage } from "@downcity/type";
import type { AgentSessionBrowserOptions, AgentArchivedSessionAddress } from "@/types/store/AgentSessionBrowser.js";
import type { AgentSessionRuntimeLease } from "@/types/store/AgentSessionRuntime.js";
import type { AgentSessionRecord, AgentSessionRecordPage, AgentSessionConfigurationRow } from "@/types/store/AgentSessionDatabase.js";
import type { AgentListSessionsInput, AgentSessionSummaryPage } from "@/types/agent/SessionTypes.js";
import type { SessionReadView } from "@/types/store/SessionReadView.js";
import { acquire_agent_session_storage } from "./AgentSessionRuntime.js";
import { agent_session_read_view, project_agent_session_record } from "./AgentSessionReadView.js";
import { resolve_prompt_request_identity } from "../../loop/SessionTurnHandles.js";
import { read_session_completion } from "../AgentPendingReferences.js";
import { decode_model_binding } from "../ModelBindingCodec.js";

/** 独立读租约可长于执行器生命周期，dispose 返回资源关闭的真实 Promise。 */
export class AgentSessionBrowser {
  private lease?: Promise<AgentSessionRuntimeLease>;
  private disposed = false;
  private disposal?: Promise<void>;
  private generation = 0;

  constructor(private readonly options: AgentSessionBrowserOptions) {}

  /** 按不可变记录身份读取，不猜测逻辑地址；调用方必须检查返回视图的归档状态。 */
  async get_record(session_id: string): Promise<SessionReadView> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(session_id)) throw new Error("session_validation_error");
    const lease = await this.connection();
    const record = await lease.read<AgentSessionRecord>({ command: "record", session_id });
    return agent_session_read_view(lease, this.options.agent_id, record);
  }

  /** 只读持久主指针；空根不创建数据库或会话。 */
  async main(): Promise<SessionReadView | null> {
    const lease = await this.collection_connection();
    if (!lease) return null;
    const record = await lease.read<AgentSessionRecord | null>({ command: "main" });
    return record ? agent_session_read_view(lease, this.options.agent_id, record) : null;
  }

  async categories(archived = false): Promise<string[]> {
    const lease = await this.collection_connection();
    return lease ? await lease.read({ command: "categories", archived }) : [];
  }

  /** 活动地址只查活动记录，归档必须使用 get_archived 的稳定地址。 */
  async get(session_id: string, category = "work"): Promise<SessionReadView> {
    if (!session_id || session_id.trim() !== session_id) throw new Error("session_validation_error");
    const lease = await this.connection();
    const record = await lease.read<AgentSessionRecord | null>({ command: "find", address: {
      archived: false, category: normalize_session_origin_category(category), session_id,
    } });
    if (!record) throw new Error("session_not_found");
    return agent_session_read_view(lease, this.options.agent_id, record);
  }

  /** 精确打开某一归档记录；同逻辑 ID 可以同时存在活动记录和多条归档。 */
  async get_archived(address: AgentArchivedSessionAddress): Promise<SessionReadView> {
    const lease = await this.connection();
    const record = await lease.read<AgentSessionRecord | null>({ command: "find", address: { archived: true, session_id: address.session_id } });
    if (!record) throw new Error("session_not_found");
    if ((address.session_id !== undefined && address.session_id !== record.session_id)
      || (address.category !== undefined && normalize_session_origin_category(address.category) !== record.category)) {
      throw new Error("session_address_conflict");
    }
    return agent_session_read_view(lease, this.options.agent_id, record);
  }

  /** 配置按记录身份独立读取，不阻塞目录或消息页。 */
  async configuration(session_id: string): Promise<AgentSessionConfigurationRow> {
    return await (await this.connection()).read({ command: "configuration", session_id });
  }

  async model_binding(session_id: string, category: string) {
    const view = await this.get(session_id, category);
    const config = await this.configuration(view.session_id);
    return config.model_binding ? decode_model_binding(config.model_binding) : undefined;
  }

  /** canonical 接收事实在同一个精确活动记录中读取，不恢复执行。 */
  async receipt(session_id: string, category: string, request_id: string) {
    const view = await this.get(session_id, category);
    const identity = resolve_prompt_request_identity(session_id, request_id);
    if (!identity) throw new Error("session_validation_error");
    const message = await (await this.connection()).read<SessionMessage | null>({ command: "message", session_id: view.session_id, id: identity.message_id });
    if (!message) return { accepted: false, completed: false, turn_id: null, result: null, execution_state: "not_found" };
    if (message.role !== "user" || message.meta?.from.kind !== "user" || message.meta.from.user_id !== "local") {
      throw new Error("session_request_forbidden");
    }
    const turn_id = message.turn_id;
    const completion = turn_id ? await read_session_completion(this.options.storage_root_path, session_id, turn_id) : undefined;
    return { accepted: true, completed: Boolean(completion), turn_id: turn_id ?? null,
      result: completion ? { turn_id, ...completion.event.result } : null,
      execution_state: completion ? "completed" : "accepted" };
  }

  /** 实时 keyset 分页：精确 total 与页处于同一 Worker 短事务，不保存全量快照。 */
  async list(input: AgentListSessionsInput = {}, archived = false): Promise<AgentSessionSummaryPage> {
    const generation = this.generation;
    const category = normalize_session_origin_category(input.category ?? "work");
    const limit = input.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("session_list_limit_invalid");
    // 游标引用已有数据库世代，只有无游标首页可按未初始化集合处理。
    const lease = input.cursor === undefined ? await this.collection_connection() : await this.connection();
    const page: AgentSessionRecordPage = lease ? await lease.read({ command: "list", input: { ...input, category, archived } })
      : { items: [], total: 0, has_more: false };
    this.assert_available();
    if (generation !== this.generation) throw new Error("session_address_changed");
    return { ...page, items: page.items.map(row => project_agent_session_record(this.options.agent_id, row)) };
  }

  /** 失效在途页面提交；持久化 keyset 游标不依赖浏览对象世代。 */
  invalidate(): void { this.generation += 1; }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true; this.invalidate();
    this.disposal = this.lease ? this.lease.then(lease => lease.release()) : Promise.resolve();
    return this.disposal;
  }

  private assert_available(): void {
    if (this.disposed) throw new Error("session_storage_lease_released");
  }

  /** 仅允许现存根的未初始化集合为空；不缓存空状态，首次写入后下次读取即可取得租约。 */
  private async collection_connection(): Promise<AgentSessionRuntimeLease | undefined> {
    try { return await this.connection(); }
    catch (error) {
      // connection 已检查旧分区；注入租约、权限、损坏和错误路径不能转为空集合。
      if (this.options.acquire_read_lease || !(error instanceof Error) || error.message !== "session_storage_not_found"
        || !(await exists(this.options.storage_root_path))) throw error;
      this.assert_available();
      return undefined;
    }
  }

  private connection(): Promise<AgentSessionRuntimeLease> {
    this.assert_available();
    if (!this.lease) this.lease = (async () => {
      if (this.options.acquire_read_lease) return await this.options.acquire_read_lease();
      const database_path = path.join(this.options.storage_root_path, "sessions.db");
      if (!(await exists(database_path))) {
        for (const partition of ["sessions", "archived-sessions"]) {
          if (await exists(path.join(this.options.storage_root_path, partition))) throw new Error("session_migration_required");
        }
        throw new Error("session_storage_not_found");
      }
      return await acquire_agent_session_storage({ agent_id: this.options.agent_id, database_path }, true);
    })().catch(error => { this.lease = undefined; throw error; });
    return this.lease;
  }
}

/** 只有明确 ENOENT 属于不存在；权限、损坏和其他 I/O 失败不伪装成空列表。 */
async function exists(file_path: string): Promise<boolean> {
  try { await fs.stat(file_path); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
