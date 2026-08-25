/**
 * 进程内底层存储 Provider。
 *
 * 用于 City 默认运行模式和测试。它只提供文件作用域，不保存任何业务语义。
 */
import type { FileSystem, WorkspaceDirectoryEntry } from "@/types/workspace/FileSystem.js";
import type { FileToolActionRequest, FileToolActionResult } from "@/types/workspace/FileTool.js";
import type { SearchToolActionRequest, SearchToolActionResult } from "@/types/workspace/SearchTool.js";
import type { StorageProvider, StorageScope } from "@/types/storage/Storage.js";

class MemoryFileSystem implements FileSystem {
  readonly root_path: string;
  private readonly entries_by_path = new Map<string, Buffer>();
  private readonly directories = new Set<string>();

  constructor(root_path: string) {
    this.root_path = root_path;
    this.directories.add(root_path);
  }

  resolve_path(...segments: string[]): string {
    return [this.root_path, ...segments].join("/").replace(/\/+/g, "/");
  }

  async path_exists(file_path: string): Promise<boolean> {
    const normalized_path = this.normalize(file_path);
    return this.entries_by_path.has(normalized_path) || this.directories.has(normalized_path);
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
    const normalized_path = this.normalize(directory_path);
    const parts = normalized_path.slice(this.root_path.length).split("/").filter(Boolean);
    let current_path = this.root_path;
    for (const part of parts) {
      current_path = `${current_path}/${part}`;
      this.directories.add(current_path);
    }
  }

  async remove_path(target_path: string): Promise<void> {
    const normalized_path = this.normalize(target_path);
    this.entries_by_path.delete(normalized_path);
    for (const directory of [...this.directories]) {
      if (directory === normalized_path || directory.startsWith(`${normalized_path}/`)) {
        this.directories.delete(directory);
      }
    }
    for (const file_path of [...this.entries_by_path.keys()]) {
      if (file_path.startsWith(`${normalized_path}/`)) this.entries_by_path.delete(file_path);
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
    for (const [file_path, content] of [...this.entries_by_path.entries()]) {
      if (file_path === source || file_path.startsWith(`${source}/`)) {
        this.entries_by_path.set(`${target}${file_path.slice(source.length)}`, content);
        this.entries_by_path.delete(file_path);
      }
    }
  }

  async read_directory(directory_path: string): Promise<WorkspaceDirectoryEntry[]> {
    const parent = this.normalize(directory_path);
    const entries = new Map<string, WorkspaceDirectoryEntry>();
    for (const directory of this.directories) this.add_entry(parent, directory, true, entries);
    for (const file_path of this.entries_by_path.keys()) this.add_entry(parent, file_path, false, entries);
    return [...entries.values()];
  }

  async write_file_atomically(file_path: string, content: string | Buffer): Promise<void> {
    const normalized_path = this.normalize(file_path);
    await this.ensure_directory(normalized_path.slice(0, normalized_path.lastIndexOf("/")));
    this.entries_by_path.set(normalized_path, Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content));
  }

  async append_file(file_path: string, content: string | Buffer): Promise<void> {
    const current = this.entries_by_path.get(this.normalize(file_path)) || Buffer.alloc(0);
    await this.write_file_atomically(file_path, Buffer.concat([current, Buffer.isBuffer(content) ? content : Buffer.from(content)]));
  }

  async with_file_lock<T>(_lock_path: string, action: () => Promise<T>): Promise<T> {
    return await action();
  }

  async run_file_action(_request: FileToolActionRequest): Promise<FileToolActionResult> {
    throw new Error("Memory storage does not provide project file tools");
  }

  async run_search_action(_request: SearchToolActionRequest): Promise<SearchToolActionResult> {
    throw new Error("Memory storage does not provide project search tools");
  }

  private normalize(file_path: string): string {
    const normalized_path = String(file_path || "").replace(/\/+/g, "/");
    return normalized_path.startsWith(this.root_path)
      ? normalized_path
      : `${this.root_path}/${normalized_path.replace(/^\/+/, "")}`;
  }

  private add_entry(
    parent: string,
    candidate: string,
    is_directory: boolean,
    entries: Map<string, WorkspaceDirectoryEntry>,
  ): void {
    if (!candidate.startsWith(`${parent}/`) || candidate === parent) return;
    const remainder = candidate.slice(parent.length + 1);
    const name = remainder.split("/")[0];
    if (!name || entries.has(name)) return;
    entries.set(name, {
      name,
      is_directory: is_directory || remainder.includes("/"),
      is_file: !is_directory && !remainder.includes("/"),
    });
  }
}

/** 进程内底层存储 Provider。 */
export class MemoryStorageProvider implements StorageProvider {
  private readonly root_files: MemoryFileSystem;
  private readonly scopes = new Map<string, StorageScope>();

  constructor(root_path = "/memory") {
    this.root_files = new MemoryFileSystem(root_path);
  }

  open_scope(segments: readonly string[]): StorageScope {
    const normalized_segments = segments.map((segment) => normalize_segment(segment));
    const scope_key = normalized_segments.join("/");
    const existing_scope = this.scopes.get(scope_key);
    if (existing_scope) return existing_scope;
    const root_path = [this.root_files.root_path, ...normalized_segments].join("/");
    const scope: StorageScope = {
      root_path,
      files: new MemoryFileSystem(root_path),
    };
    this.scopes.set(scope_key, scope);
    return scope;
  }
}

function normalize_segment(value: string): string {
  const segment = String(value || "").trim();
  if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
    throw new Error("Storage scope contains an invalid segment");
  }
  return segment;
}
