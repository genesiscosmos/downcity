/**
 * Agent 与 Group 无宿主模式使用的私有进程内存储。
 *
 * 该实现只保证 Agent/Group Store 所需的文件原语，不作为 SDK 资源公开。正式 City
 * 运行时会在创建 Session 前注入 City 持有的 StorageProvider。
 */

import type {
  FileSystem,
  FileToolActionRequest,
  FileToolActionResult,
  SearchToolActionRequest,
  SearchToolActionResult,
  StorageProvider,
  StorageScope,
  WorkspaceDirectoryEntry,
} from "@downcity/type/workspace";

/** 单一内存作用域内的最小文件系统。 */
class AgentMemoryFileSystem implements FileSystem {
  /** 当前作用域的稳定逻辑根路径。 */
  readonly root_path: string;

  /** 按规范化路径保存的文件字节。 */
  private readonly files_by_path = new Map<string, Buffer>();

  /** 当前作用域中已经创建的目录。 */
  private readonly directories = new Set<string>();

  constructor(root_path: string) {
    this.root_path = root_path;
    this.directories.add(root_path);
  }

  /** 将输入路径约束到当前逻辑根目录。 */
  resolve_path(...segments: string[]): string {
    return this.normalize(segments.join("/"));
  }

  /** 判断文件或目录是否存在。 */
  async path_exists(file_path: string): Promise<boolean> {
    const target_path = this.normalize(file_path);
    return this.files_by_path.has(target_path) || this.directories.has(target_path);
  }

  /** 返回文件字节的独立副本。 */
  async read_file(file_path: string): Promise<Buffer> {
    const content = this.files_by_path.get(this.normalize(file_path));
    if (!content) throw Object.assign(new Error("File not found"), { code: "ENOENT" });
    return Buffer.from(content);
  }

  /** 返回文件字节大小。 */
  async file_size(file_path: string): Promise<number> {
    return (await this.read_file(file_path)).byteLength;
  }

  /** 创建目录和缺失的父目录。 */
  async ensure_directory(directory_path: string): Promise<void> {
    const target_path = this.normalize(directory_path);
    const parts = target_path.slice(this.root_path.length).split("/").filter(Boolean);
    let current_path = this.root_path;
    for (const part of parts) {
      current_path = `${current_path}/${part}`;
      this.directories.add(current_path);
    }
  }

  /** 幂等删除目标路径及其子内容。 */
  async remove_path(target_path: string): Promise<void> {
    const normalized_path = this.normalize(target_path);
    for (const file_path of [...this.files_by_path.keys()]) {
      if (file_path === normalized_path || file_path.startsWith(`${normalized_path}/`)) {
        this.files_by_path.delete(file_path);
      }
    }
    for (const directory_path of [...this.directories]) {
      if (directory_path === normalized_path || directory_path.startsWith(`${normalized_path}/`)) {
        this.directories.delete(directory_path);
      }
    }
  }

  /** 原子移动一个文件或目录树。 */
  async move_path(source_path: string, target_path: string): Promise<void> {
    const source = this.normalize(source_path);
    const target = this.normalize(target_path);
    if (await this.path_exists(target)) throw new Error(`Target already exists: ${target}`);
    for (const [file_path, content] of [...this.files_by_path.entries()]) {
      if (file_path === source || file_path.startsWith(`${source}/`)) {
        this.files_by_path.set(`${target}${file_path.slice(source.length)}`, content);
        this.files_by_path.delete(file_path);
      }
    }
    for (const directory_path of [...this.directories]) {
      if (directory_path === source || directory_path.startsWith(`${source}/`)) {
        this.directories.add(`${target}${directory_path.slice(source.length)}`);
        this.directories.delete(directory_path);
      }
    }
  }

  /** 列出目标目录的直接子条目。 */
  async read_directory(directory_path: string): Promise<WorkspaceDirectoryEntry[]> {
    const parent_path = this.normalize(directory_path);
    const entries = new Map<string, WorkspaceDirectoryEntry>();
    for (const directory of this.directories) this.add_entry(parent_path, directory, true, entries);
    for (const file_path of this.files_by_path.keys()) this.add_entry(parent_path, file_path, false, entries);
    return [...entries.values()];
  }

  /** 原子写入完整文件内容。 */
  async write_file_atomically(file_path: string, content: string | Buffer): Promise<void> {
    const target_path = this.normalize(file_path);
    await this.ensure_directory(target_path.slice(0, target_path.lastIndexOf("/")));
    this.files_by_path.set(target_path, Buffer.from(content));
  }

  /** 向目标文件追加内容。 */
  async append_file(file_path: string, content: string | Buffer): Promise<void> {
    const current = this.files_by_path.get(this.normalize(file_path)) ?? Buffer.alloc(0);
    await this.write_file_atomically(file_path, Buffer.concat([current, Buffer.from(content)]));
  }

  /** 内存作用域在单线程事件循环中直接执行文件事务。 */
  async with_file_lock<T>(_lock_path: string, action: () => Promise<T>): Promise<T> {
    return await action();
  }

  /** Agent 私有存储不提供项目文件工具。 */
  async run_file_action(_request: FileToolActionRequest): Promise<FileToolActionResult> {
    throw new Error("Agent memory storage does not provide project file tools");
  }

  /** Agent 私有存储不提供项目搜索工具。 */
  async run_search_action(_request: SearchToolActionRequest): Promise<SearchToolActionResult> {
    throw new Error("Agent memory storage does not provide project search tools");
  }

  /** 规范化并校验当前作用域内的逻辑路径。 */
  private normalize(file_path: string): string {
    const normalized_path = String(file_path || "").replace(/\/+/g, "/");
    const relative_path = normalized_path.startsWith(this.root_path)
      ? normalized_path.slice(this.root_path.length)
      : normalized_path;
    const parts = relative_path.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === "..")) {
      throw new Error(`Path escapes Agent memory storage: ${file_path}`);
    }
    return [this.root_path, ...parts].join("/");
  }

  /** 将候选路径归并为一个直接子条目。 */
  private add_entry(
    parent_path: string,
    candidate_path: string,
    is_directory: boolean,
    entries: Map<string, WorkspaceDirectoryEntry>,
  ): void {
    if (!candidate_path.startsWith(`${parent_path}/`) || candidate_path === parent_path) return;
    const remainder = candidate_path.slice(parent_path.length + 1);
    const name = remainder.split("/")[0];
    if (!name || entries.has(name)) return;
    entries.set(name, {
      name,
      is_directory: is_directory || remainder.includes("/"),
      is_file: !is_directory && !remainder.includes("/"),
    });
  }
}

/** 为无宿主 Agent/Group 创建隔离的进程内 StorageProvider。 */
export class AgentMemoryStorageProvider implements StorageProvider {
  /** 按完整 scope key 缓存稳定作用域。 */
  private readonly scopes_by_key = new Map<string, StorageScope>();

  /** 当前 Provider 的逻辑根目录。 */
  private readonly root_path: string;

  constructor(root_path = "/agent-memory") {
    this.root_path = root_path;
  }

  /** 打开或复用一个受路径片段约束的内存作用域。 */
  open_scope(segments: readonly string[]): StorageScope {
    const normalized_segments = segments.map((segment) => normalize_scope_segment(segment));
    const scope_key = normalized_segments.join("/");
    const existing = this.scopes_by_key.get(scope_key);
    if (existing) return existing;
    const root_path = [this.root_path, ...normalized_segments].join("/");
    const scope = Object.freeze({
      root_path,
      files: new AgentMemoryFileSystem(root_path),
      database_location: { type: "memory" as const },
    });
    this.scopes_by_key.set(scope_key, scope);
    return scope;
  }
}

/** 校验 Storage scope 的单个稳定路径片段。 */
function normalize_scope_segment(value: string): string {
  const segment = String(value || "").trim();
  if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
    throw new Error("Storage scope contains an invalid segment");
  }
  return segment;
}
