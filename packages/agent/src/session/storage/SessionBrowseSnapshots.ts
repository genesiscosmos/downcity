/**
 * file Worker 与 memory 共用的有界稳定快照协议，按进程分区统一淘汰。
 * 摘要按 JSON UTF-8 两倍加每条固定开销估算，预算包含构建中快照；超限明确失败。
 * 游标由实例密钥签名，绑定随机快照及规范化查询，分页不再访问数据库。
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AgentSessionSummaryPage } from "../../types/agent/SessionTypes.js";
import type {
  SessionBrowseBaseInput, SessionBrowseCursor, SessionBrowseQuery, SessionBrowseSnapshot,
} from "../../types/store/SessionBrowse.js";
import { build_session_info } from "./Browse.js";

export const SESSION_BROWSE_TTL_MS = 120_000;
export const SESSION_BROWSE_STORE_BYTES = 16 * 1024 * 1024;

/** 游标无效、失效、淘汰及跨查询共用可识别错误。 */
export function session_list_cursor_expired(): Error {
  return new Error("session_list_cursor_expired: Session list snapshot is unavailable; restart from the first page");
}

/** 多 Store 快照仓库；file 在共享 Worker，memory 在主线程，分别有固定预算。 */
export class SessionBrowseSnapshots {
  /** 签名密钥仅在本实例存活。 */
  private readonly secret = randomBytes(32);
  /** 完成快照，按最近访问顺序淘汰。 */
  private readonly snapshots = new Map<string, SessionBrowseSnapshot>();
  /** 每个 Store 最多一个构建，进程准入最多 64 个。 */
  private readonly building = new Map<string, SessionBrowseSnapshot>();
  /** 单个最近到期定时器，memory 在无后续查询时也物理释放引用。 */
  private expiry_timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly max_bytes: number) {}

  /** 清空快照与构建状态。 */
  clear(store_id: string): void {
    for (const [key, snapshot] of this.snapshots) {
      if (snapshot.store_id === store_id) this.snapshots.delete(key);
    }
    this.building.delete(store_id);
    this.schedule_expiry();
  }

  /** 开始新快照，先淘汰过期项与超出数量限制的旧项。 */
  begin(query: SessionBrowseQuery): void {
    this.prune();
    this.building.delete(query.store_id);
    const query_key = JSON.stringify(query);
    const query_bytes = Buffer.byteLength(query_key, "utf8");
    if (query_bytes > 64 * 1024) throw new Error("session_list_query_too_large: Query exceeds 64 KiB");
    const base_bytes = query_bytes * 2 + 256;
    while (this.store_snapshots(query.store_id) >= 2 ||
           (this.total_bytes(query.store_id) + base_bytes > SESSION_BROWSE_STORE_BYTES &&
            this.store_snapshots(query.store_id))) this.evict_oldest(query.store_id);
    // 空快照也有数量上限，避免大量空目录消耗无界元数据。
    while (this.snapshots.size >= 128) this.evict_oldest();
    while (this.total_bytes() + base_bytes > this.max_bytes && this.snapshots.size) this.evict_oldest();
    if (this.total_bytes() + base_bytes > this.max_bytes || this.building.size >= 64) {
      throw new Error("session_list_snapshot_budget_exceeded: Build capacity exhausted");
    }
    this.building.set(query.store_id, {
      snapshot_id: randomUUID(), store_id: query.store_id, query_key, items: [],
      bytes: base_bytes, expires_at: Date.now() + SESSION_BROWSE_TTL_MS,
    });
    this.schedule_expiry();
  }

  /** 每条投影即刻过滤与计费，不累计无界中间数组。 */
  append(input: SessionBrowseBaseInput, query: SessionBrowseQuery): void {
    const snapshot = this.require_building(query);
    const metadata = input.metadata;
    if (metadata.agent_id !== query.agent_id || metadata.origin.category !== query.category ||
        (query.workspace_id && metadata.workspace_id !== query.workspace_id) ||
        (query.origin_type && metadata.origin.type !== query.origin_type)) return;
    const summary = build_session_info({ ...input, executing: false });
    if (query.query && ![summary.session_id, summary.title || "", summary.preview_text || ""]
      .join("\n").toLowerCase().includes(query.query)) return;
    const bytes = Buffer.byteLength(JSON.stringify(summary), "utf8") * 2 + 256;
    while ((this.total_bytes(query.store_id) + bytes > SESSION_BROWSE_STORE_BYTES ||
            this.total_rows(query.store_id) >= 20_000) && this.store_snapshots(query.store_id)) {
      this.evict_oldest(query.store_id);
    }
    while ((this.total_bytes() + bytes > this.max_bytes || this.total_rows() >= 60_000) && this.snapshots.size) {
      this.evict_oldest();
    }
    if (this.total_bytes(query.store_id) + bytes > SESSION_BROWSE_STORE_BYTES ||
        this.total_bytes() + bytes > this.max_bytes || this.total_rows(query.store_id) >= 20_000 ||
        this.total_rows() >= 60_000) {
      this.building.delete(query.store_id);
      this.schedule_expiry();
      throw new Error("session_list_snapshot_budget_exceeded: Summary byte or row budget exhausted");
    }
    snapshot.items.push(structuredClone(summary));
    snapshot.bytes += bytes;
  }

  /** 发布排序后的快照，并返回第一页。 */
  finish(query: SessionBrowseQuery, limit: number): AgentSessionSummaryPage {
    const snapshot = this.require_building(query);
    snapshot.items.sort((left, right) => (right.updated_at || 0) - (left.updated_at || 0) ||
      (left.session_id < right.session_id ? -1 : left.session_id > right.session_id ? 1 : 0));
    snapshot.expires_at = Date.now() + SESSION_BROWSE_TTL_MS;
    this.building.delete(query.store_id);
    while (this.snapshots.size >= 128) this.evict_oldest();
    this.snapshots.set(snapshot.snapshot_id, snapshot);
    this.schedule_expiry();
    return this.slice(snapshot, 0, limit);
  }

  /** 已有游标只访问原快照，禁止自动重建。 */
  page(query: SessionBrowseQuery, cursor: string, limit: number): AgentSessionSummaryPage {
    this.prune();
    const payload = this.decode_cursor(cursor);
    const snapshot = this.snapshots.get(payload.snapshot_id);
    if (!snapshot || snapshot.query_key !== JSON.stringify(query) || payload.offset >= snapshot.items.length) {
      throw session_list_cursor_expired();
    }
    // 最近访问的快照排在最后，容量压力下先淘汰最久未访问者。
    this.snapshots.delete(snapshot.snapshot_id);
    this.snapshots.set(snapshot.snapshot_id, snapshot);
    return this.slice(snapshot, payload.offset, limit);
  }

  /** 拒绝已过期或不匹配的构建。 */
  private require_building(query: SessionBrowseQuery): SessionBrowseSnapshot {
    const snapshot = this.building.get(query.store_id);
    if (snapshot && snapshot.expires_at <= Date.now()) {
      this.building.delete(query.store_id);
      this.schedule_expiry();
      throw session_list_cursor_expired();
    }
    if (!snapshot || snapshot.query_key !== JSON.stringify(query)) throw session_list_cursor_expired();
    return snapshot;
  }

  /** 完成态及构建态共同计费。 */
  private total_bytes(store_id?: string): number {
    let bytes = 0;
    for (const snapshot of this.building.values()) {
      if (!store_id || snapshot.store_id === store_id) bytes += snapshot.bytes;
    }
    for (const snapshot of this.snapshots.values()) {
      if (!store_id || snapshot.store_id === store_id) bytes += snapshot.bytes;
    }
    return bytes;
  }

  /** 行数也有硬上限：每 Store 20,000 行，每个进程分区 60,000 行，包含构建态。 */
  private total_rows(store_id?: string): number {
    let rows = 0;
    for (const snapshot of this.building.values()) {
      if (!store_id || snapshot.store_id === store_id) rows += snapshot.items.length;
    }
    for (const snapshot of this.snapshots.values()) {
      if (!store_id || snapshot.store_id === store_id) rows += snapshot.items.length;
    }
    return rows;
  }

  /** 当前 Store 已完成的快照数。 */
  private store_snapshots(store_id: string): number {
    let count = 0;
    for (const snapshot of this.snapshots.values()) if (snapshot.store_id === store_id) count += 1;
    return count;
  }

  /** 淘汰最久未访问的完成态快照，可限定 Store。 */
  private evict_oldest(store_id?: string): void {
    for (const [key, snapshot] of this.snapshots) {
      if (store_id && snapshot.store_id !== store_id) continue;
      this.snapshots.delete(key);
      return;
    }
  }

  /** TTL 为绝对时间，不因翻页延长。 */
  private prune(): void {
    const now = Date.now();
    for (const [key, snapshot] of this.snapshots) {
      if (snapshot.expires_at <= now) this.snapshots.delete(key);
    }
    for (const [key, snapshot] of this.building) {
      if (snapshot.expires_at <= now) this.building.delete(key);
    }
    this.schedule_expiry();
  }

  /** 最近到期时立即回收完成态和构建态；定时器不延长 Node 进程生命周期。 */
  private schedule_expiry(): void {
    if (this.expiry_timer) clearTimeout(this.expiry_timer);
    this.expiry_timer = undefined;
    let earliest = Infinity;
    for (const snapshot of this.snapshots.values()) earliest = Math.min(earliest, snapshot.expires_at);
    for (const snapshot of this.building.values()) earliest = Math.min(earliest, snapshot.expires_at);
    if (!Number.isFinite(earliest)) return;
    this.expiry_timer = setTimeout(() => this.prune(), Math.max(1, earliest - Date.now()));
    this.expiry_timer.unref();
  }

  /** 只复制当前页；执行状态由主线程在返回时覆盖。 */
  private slice(snapshot: SessionBrowseSnapshot, offset: number, limit: number): AgentSessionSummaryPage {
    const items = structuredClone(snapshot.items.slice(offset, offset + limit));
    const next_offset = offset + items.length;
    const has_more = next_offset < snapshot.items.length;
    return {
      items, total: snapshot.items.length, has_more,
      ...(has_more ? { next_cursor: this.encode_cursor({ snapshot_id: snapshot.snapshot_id, offset: next_offset }) } : {}),
    };
  }

  /** 对快照身份和偏移签名，调用方不能制造任意偏移。 */
  private encode_cursor(payload: SessionBrowseCursor): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${createHmac("sha256", this.secret).update(body).digest("base64url")}`;
  }

  /** 有界解析并验签，旧数字 cursor 也明确报过期。 */
  private decode_cursor(cursor: string): SessionBrowseCursor {
    try {
      if (cursor.length > 1024) throw session_list_cursor_expired();
      const [body, signature, extra] = cursor.split(".");
      if (!body || !signature || extra !== undefined) throw session_list_cursor_expired();
      const expected = createHmac("sha256", this.secret).update(body).digest();
      const actual = Buffer.from(signature, "base64url");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw session_list_cursor_expired();
      const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionBrowseCursor;
      if (typeof value.snapshot_id !== "string" || !Number.isSafeInteger(value.offset) || value.offset < 1) {
        throw session_list_cursor_expired();
      }
      return value;
    } catch {
      throw session_list_cursor_expired();
    }
  }
}
