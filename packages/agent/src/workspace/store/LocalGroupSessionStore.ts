/** LocalGroupSessionStore：基于 City StorageScope 的 GroupSession 集合存储。 */

import path from "node:path";
import type { FileSystem } from "@downcity/type";
import type {
  GroupSessionDataStore,
  GroupSessionHistoryMeta,
  GroupSessionStore,
  GroupSessionStoreOptions,
} from "@/types/group/GroupSessionStore.js";
import { LocalGroupSessionDataStore } from "@/workspace/store/LocalGroupSessionDataStore.js";

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

  /** 返回指定 GroupSession 的持久化视图。 */
  session(session_id: string): GroupSessionDataStore {
    const resolved_session_id = String(session_id || "").trim();
    if (!resolved_session_id) throw new Error("GroupSessionStore.session requires a non-empty session_id");
    const cached = this.sessions_by_id.get(resolved_session_id);
    if (cached) return cached;
    const created = new LocalGroupSessionDataStore({
      files: this.files,
      storage_root_path: this.storage_root_path,
      session_id: resolved_session_id,
      group_id: this.group_id,
    });
    this.sessions_by_id.set(resolved_session_id, created);
    return created;
  }

  /** 判断指定 GroupSession 是否存在。 */
  async has_session(session_id: string): Promise<boolean> {
    return await this.files.path_exists(this.session_path(session_id));
  }

  /** 列出当前 Group 的全部 Session metadata。 */
  async list_session_metadata(): Promise<GroupSessionHistoryMeta[]> {
    const sessions_path = path.join(path.resolve(this.storage_root_path), "sessions");
    if (!(await this.files.path_exists(sessions_path))) return [];
    const entries = await this.files.read_directory(sessions_path);
    const metadata: GroupSessionHistoryMeta[] = [];
    for (const entry of entries.filter((item) => item.is_directory)) {
      const session_id = decode_session_id(entry.name);
      metadata.push(await this.session(session_id).read_metadata());
    }
    return metadata.sort((left, right) => right.updated_at - left.updated_at);
  }

  /** 删除指定 GroupSession 的全部数据。 */
  async remove_session(session_id: string): Promise<boolean> {
    const resolved_session_id = String(session_id || "").trim();
    const session_path = this.session_path(resolved_session_id);
    const existed = await this.files.path_exists(session_path);
    if (existed) await this.files.remove_path(session_path);
    this.sessions_by_id.delete(resolved_session_id);
    return existed;
  }

  /** 释放当前 Store 的运行时缓存。 */
  async dispose(): Promise<void> {
    this.sessions_by_id.clear();
  }

  private session_path(session_id: string): string {
    return path.join(
      path.resolve(this.storage_root_path),
      "sessions",
      encodeURIComponent(String(session_id || "").trim()),
    );
  }
}

function decode_session_id(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}
