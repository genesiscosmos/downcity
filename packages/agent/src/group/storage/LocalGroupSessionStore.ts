/** LocalGroupSessionStore：基于 City StorageScope 的 GroupSession 集合存储。 */

import path from "node:path";
import type { FileSystem } from "@downcity/type";
import type {
  GroupSessionDataStore,
  GroupSessionHistoryMeta,
  GroupSessionStore,
  GroupSessionStoreOptions,
} from "@/types/group/GroupSessionStore.js";
import type { GroupSessionArchiveResult, GroupSessionCleanArchiveResult } from "@/types/group/GroupSession.js";
import { LocalGroupSessionDataStore } from "@/group/storage/LocalGroupSessionDataStore.js";

/**
 * GroupSession 的两个存储区。
 *
 * ```text
 * <group-root>/sessions/<session_id>/           活动
 * <group-root>/archived-sessions/<session_id>/  归档
 * ```
 *
 * 归档是**目录搬迁**而不是打标记：活动列表因此天然只含活动项，
 * `list_session_metadata()` 不需要加过滤条件，`metadata.v` 也不用升版本。
 * 这与 Agent Session 的做法一致（`LocalSessionStore.archive_session`），
 * 两处同类能力不该有两套语义。
 */
type SessionArea = "active" | "archived";

/** 各存储区的目录名。 */
const area_directory_name: Record<SessionArea, string> = {
  active: "sessions",
  archived: "archived-sessions",
};

/** GroupSession 的底层文件 Store。 */
export class LocalGroupSessionStore implements GroupSessionStore {
  private readonly files: FileSystem;
  private readonly storage_root_path: string;
  private readonly group_id: string;
  private readonly sessions_by_id = new Map<string, LocalGroupSessionDataStore>();

  constructor(options: GroupSessionStoreOptions) {
    this.files = options.files;
    this.storage_root_path = options.storage_root_path;
    this.group_id = options.group_id;
  }

  /**
   * 返回指定 GroupSession 的持久化视图。
   *
   * 缓存键带存储区：同一个 session_id 在活动区与归档区各有一份视图，
   * 不分区的话归档后会拿到活动区的旧视图（路径指向已经不存在的目录）。
   */
  session(session_id: string, area: SessionArea = "active"): GroupSessionDataStore {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) throw new Error("GroupSessionStore.session requires a non-empty session_id");
    const cache_key = `${area}:${resolved_session_id}`;
    const cached = this.sessions_by_id.get(cache_key);
    if (cached) return cached;
    const created = new LocalGroupSessionDataStore({
      files: this.files,
      storage_root_path: this.storage_root_path,
      session_id: resolved_session_id,
      group_id: this.group_id,
      area,
    });
    this.sessions_by_id.set(cache_key, created);
    return created;
  }

  /** 判断指定 GroupSession 是否存在（活动区）。 */
  async has_session(session_id: string): Promise<boolean> {
    return await this.files.path_exists(this.session_path(session_id, "active"));
  }

  /** 列出当前 Group 活动区的全部 Session metadata（不含已归档）。 */
  async list_session_metadata(): Promise<GroupSessionHistoryMeta[]> {
    return await this.list_area_metadata("active");
  }

  /** 列出归档区的 Session metadata。 */
  async list_archived_session_metadata(): Promise<GroupSessionHistoryMeta[]> {
    return await this.list_area_metadata("archived");
  }

  /** 删除指定 GroupSession 的全部数据（活动区）。 */
  async remove_session(session_id: string): Promise<boolean> {
    return await this.remove_area_session(session_id, "active");
  }

  /** 删除归档区中的指定 Session。 */
  async remove_archived_session(session_id: string): Promise<boolean> {
    return await this.remove_area_session(session_id, "archived");
  }

  /**
   * 把一个活动 GroupSession 迁入归档区。
   *
   * 用 `move_path` 而不是「复制再删除」：它是原子的，且**不覆盖已有目标**——
   * 后者正是这里要的语义（覆盖会丢掉一份真实数据）。两个方向的失败都必须报错，
   * 不能静默成功。
   *
   * **先查归档区再查活动区**，顺序不能反：重复归档时活动区已经空了，
   * 先查活动区会报「not found」——而用户明明看得到那条群聊（在归档区），
   * 那句话只会让他以为数据丢了。报「已归档」才是他需要知道的事。
   */
  async archive_session(session_id: string): Promise<GroupSessionArchiveResult> {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) throw new Error("GroupSessionStore.archive_session requires a non-empty session_id");
    const target_path = this.session_path(resolved_session_id, "archived");
    if (await this.files.path_exists(target_path)) {
      throw new Error(`Archived GroupSession "${resolved_session_id}" already exists`);
    }
    const source_path = this.session_path(resolved_session_id, "active");
    if (!(await this.files.path_exists(source_path))) {
      throw new Error(`GroupSession "${resolved_session_id}" not found`);
    }
    await this.files.ensure_directory(this.area_path("archived"));
    await this.files.move_path(source_path, target_path);
    // 运行时缓存指向的是活动区路径；搬迁后必须丢掉它，否则下次 `session()` 会拿到旧视图。
    this.sessions_by_id.delete(`active:${resolved_session_id}`);
    return { session_id: resolved_session_id, archived_at: Date.now() };
  }

  /** 永久清空归档区。 */
  async clean_archive(): Promise<GroupSessionCleanArchiveResult> {
    const archived_path = this.area_path("archived");
    if (!(await this.files.path_exists(archived_path))) return { removed_session_ids: [] };
    const entries = await this.files.read_directory(archived_path);
    const removed_session_ids = entries
      .filter((entry) => entry.is_directory)
      .map((entry) => decode_session_id(entry.name));
    await this.files.remove_path(archived_path);
    return { removed_session_ids };
  }

  /**
   * 永久删除当前 Group 的全部 GroupSession 数据。
   *
   * 两个区都删：Group 被删时它的活动会话与归档一样无处可访问，留着只是磁盘泄漏。
   * 只删两个区目录而不是整个作用域根：作用域可能还装着 Group 的其它私有数据，
   * 那些不归这个 Store 管。
   */
  async purge(): Promise<void> {
    await this.files.remove_path(this.area_path("active"));
    await this.files.remove_path(this.area_path("archived"));
    this.sessions_by_id.clear();
  }

  /** 释放当前 Store 的运行时缓存。 */
  async dispose(): Promise<void> {
    this.sessions_by_id.clear();
  }

  /** 一个存储区的根目录。 */
  private area_path(area: SessionArea): string {
    return path.join(path.resolve(this.storage_root_path), area_directory_name[area]);
  }

  /**
   * 某个区里单个 Session 的目录。
   *
   * 两个区共用同一段拼接：各写一遍必然分叉，而这类路径一旦分叉，
   * 表现是「归档后找不到了」——极难归因。
   */
  private session_path(session_id: string, area: SessionArea): string {
    return path.join(this.area_path(area), encodeURIComponent(String(session_id || "").trim()));
  }

  /** 列出某个区的全部 Session metadata，按最近更新倒序。 */
  private async list_area_metadata(area: SessionArea): Promise<GroupSessionHistoryMeta[]> {
    const area_path = this.area_path(area);
    if (!(await this.files.path_exists(area_path))) return [];
    const entries = await this.files.read_directory(area_path);
    const metadata: GroupSessionHistoryMeta[] = [];
    for (const entry of entries.filter((item) => item.is_directory)) {
      metadata.push(await this.session(decode_session_id(entry.name), area).read_metadata());
    }
    return metadata.sort((left, right) => right.updated_at - left.updated_at);
  }

  /** 删除某个区里的一个 Session。 */
  private async remove_area_session(session_id: string, area: SessionArea): Promise<boolean> {
    const resolved_session_id = String(session_id || "").trim();
    const session_path = this.session_path(resolved_session_id, area);
    const existed = await this.files.path_exists(session_path);
    if (existed) await this.files.remove_path(session_path);
    // 只清这个区的缓存：同一个 id 在另一个区可能仍有视图。
    this.sessions_by_id.delete(`${area}:${resolved_session_id}`);
    return existed;
  }
}

function decode_session_id(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}
