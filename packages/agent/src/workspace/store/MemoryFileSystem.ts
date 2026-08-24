/**
 * MemoryFileSystem：供无 City、无 Workspace 的 Session 使用的进程内文件协议。
 *
 * 该实现只承载 SessionStore 所需的文件操作，不提供项目文件工具或搜索能力。
 */
import type {
  FileSystem,
  WorkspaceDirectoryEntry,
} from "@downcity/workspace";
import type { FileToolActionRequest, FileToolActionResult } from "@downcity/workspace";
import type { SearchToolActionRequest, SearchToolActionResult } from "@downcity/workspace";

export class MemoryFileSystem implements FileSystem {
  private static readonly shared_by_root = new Map<string, MemoryFileSystem>();

  /** 返回进程内同一根路径的共享内存文件系统。 */
  static shared(root_path = "/memory"): MemoryFileSystem {
    const key = String(root_path || "/memory");
    const existing = MemoryFileSystem.shared_by_root.get(key);
    if (existing) return existing;
    const created = new MemoryFileSystem(key);
    MemoryFileSystem.shared_by_root.set(key, created);
    return created;
  }

  readonly root_path: string;
  private readonly entries_by_path = new Map<string, Buffer>();
  private readonly directories = new Set<string>();

  constructor(root_path = "/memory") {
    this.root_path = root_path;
    this.directories.add(this.root_path);
  }

  resolve_path(...segments: string[]): string {
    return [this.root_path, ...segments].join("/").replace(/\/+/g, "/");
  }

  async path_exists(file_path: string): Promise<boolean> {
    const path = this.normalize(file_path);
    return this.entries_by_path.has(path) || this.directories.has(path);
  }

  async read_file(file_path: string): Promise<Buffer> {
    const value = this.entries_by_path.get(this.normalize(file_path));
    if (!value) throw Object.assign(new Error("File not found"), { code: "ENOENT" });
    return Buffer.from(value);
  }

  async file_size(file_path: string): Promise<number> {
    return (await this.read_file(file_path)).byteLength;
  }

  async ensure_directory(directory_path: string): Promise<void> {
    const path = this.normalize(directory_path);
    const parts = path.slice(this.root_path.length).split("/").filter(Boolean);
    let current = this.root_path;
    this.directories.add(current);
    for (const part of parts) {
      current = `${current}/${part}`;
      this.directories.add(current);
    }
  }

  async remove_path(target_path: string): Promise<void> {
    const path = this.normalize(target_path);
    this.entries_by_path.delete(path);
    for (const directory of [...this.directories]) {
      if (directory === path || directory.startsWith(`${path}/`)) this.directories.delete(directory);
    }
    for (const file of [...this.entries_by_path.keys()]) {
      if (file.startsWith(`${path}/`)) this.entries_by_path.delete(file);
    }
  }

  async move_path(source_path: string, target_path: string): Promise<void> {
    const source = this.normalize(source_path);
    const target = this.normalize(target_path);
    if (await this.path_exists(target)) throw new Error(`Target already exists: ${target}`);
    for (const directory of [...this.directories]) {
      if (directory === source || directory.startsWith(`${source}/`)) {
        this.directories.add(`${target}${directory.slice(source.length)}`);
        this.directories.delete(directory);
      }
    }
    for (const [file, content] of [...this.entries_by_path.entries()]) {
      if (file === source || file.startsWith(`${source}/`)) {
        this.entries_by_path.set(`${target}${file.slice(source.length)}`, content);
        this.entries_by_path.delete(file);
      }
    }
  }

  async read_directory(directory_path: string): Promise<WorkspaceDirectoryEntry[]> {
    const path = this.normalize(directory_path);
    const names = new Map<string, WorkspaceDirectoryEntry>();
    for (const directory of this.directories) this.add_entry(path, directory, true, names);
    for (const file of this.entries_by_path.keys()) this.add_entry(path, file, false, names);
    return [...names.values()];
  }

  async write_file_atomically(file_path: string, content: string | Buffer): Promise<void> {
    const path = this.normalize(file_path);
    await this.ensure_directory(path.slice(0, path.lastIndexOf("/")));
    this.entries_by_path.set(path, Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content));
  }

  async append_file(file_path: string, content: string | Buffer): Promise<void> {
    const current = this.entries_by_path.get(this.normalize(file_path)) || Buffer.alloc(0);
    await this.write_file_atomically(file_path, Buffer.concat([current, Buffer.isBuffer(content) ? content : Buffer.from(content)]));
  }

  async with_file_lock<T>(_lock_path: string, action: () => Promise<T>): Promise<T> { return await action(); }
  async run_file_action(_request: FileToolActionRequest): Promise<FileToolActionResult> { throw new Error("MemoryFileSystem does not provide file tools"); }
  async run_search_action(_request: SearchToolActionRequest): Promise<SearchToolActionResult> { throw new Error("MemoryFileSystem does not provide search tools"); }

  private normalize(file_path: string): string {
    const path = String(file_path || "").replace(/\/+/g, "/");
    return path.startsWith(this.root_path) ? path : `${this.root_path}/${path.replace(/^\/+/, "")}`;
  }

  private add_entry(parent: string, candidate: string, is_directory: boolean, entries: Map<string, WorkspaceDirectoryEntry>): void {
    if (!candidate.startsWith(`${parent}/`) || candidate === parent) return;
    const remainder = candidate.slice(parent.length + 1);
    const name = remainder.split("/")[0];
    if (!name || entries.has(name)) return;
    entries.set(name, { name, is_directory: is_directory || remainder.includes("/"), is_file: !is_directory && !remainder.includes("/") });
  }
}
