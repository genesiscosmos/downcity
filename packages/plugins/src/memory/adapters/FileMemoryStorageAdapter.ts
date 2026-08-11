/**
 * FileMemoryStorageAdapter：Builtin Memory Provider 的本地文本存储实现。
 *
 * 关键点（中文）
 * - 只理解 Provider 内部逻辑 key，不理解 memory_id、召回或提炼语义。
 * - 所有 key 都被限制在独占 root_path 内，拒绝绝对路径和目录穿越。
 * - 原子写入通过同目录临时文件加 rename 完成。
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type {
  DefaultFileMemoryRootInput,
  FileMemoryStorageAdapterOptions,
} from "@/memory/types/BuiltinMemoryProvider.js";
import type {
  MemoryStorageAdapter,
  MemoryStorageEntry,
} from "@/memory/types/MemoryStorage.js";

/** 校验并规范化 Provider 内部逻辑 key。 */
function normalize_storage_key(input: string): string {
  const key = String(input || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!key) throw new Error("Memory storage key is required");
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid Memory storage key: ${input}`);
  }
  return segments.join("/");
}

/** 递归列出目录中的全部普通文件。 */
async function list_files_recursively(directory_path: string): Promise<string[]> {
  const entries = await readdir(directory_path, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const files: string[] = [];
  for (const entry of entries) {
    const entry_path = path.join(directory_path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await list_files_recursively(entry_path));
    } else if (entry.isFile() && !entry.name.endsWith(".tmp")) {
      files.push(entry_path);
    }
  }
  return files;
}

/**
 * 返回 Builtin File Adapter 的默认 Agent 级存储目录。
 *
 * 关键点（中文）：该路径规则属于 Memory Plugin 的本地 Adapter，不属于 Agent SDK。
 */
export function get_default_file_memory_root_path(
  input: DefaultFileMemoryRootInput,
): string {
  const platform_root_input = String(input.platform_root_path || "").trim();
  if (!platform_root_input || !path.isAbsolute(platform_root_input)) {
    throw new Error("Memory platform_root_path must be absolute");
  }
  const platform_root_path = path.resolve(platform_root_input);
  const agent_id = String(input.agent_id || "").trim();
  if (!agent_id || !/^[a-z0-9_]+$/u.test(agent_id)) {
    throw new Error(`Invalid Memory agent_id: ${input.agent_id}`);
  }
  return path.join(platform_root_path, "agents", agent_id, "memory");
}

/** 基于本地文件的 Memory Storage Adapter。 */
export class FileMemoryStorageAdapter implements MemoryStorageAdapter {
  /** 当前 Adapter 稳定名称。 */
  readonly name = "file";

  /** 当前 Adapter 独占的绝对根目录。 */
  readonly root_path: string;

  constructor(options: FileMemoryStorageAdapterOptions) {
    const root_path = String(options.root_path || "").trim();
    if (!root_path) throw new Error("FileMemoryStorageAdapter requires root_path");
    if (!path.isAbsolute(root_path)) {
      throw new Error("FileMemoryStorageAdapter root_path must be absolute");
    }
    this.root_path = path.resolve(root_path);
  }

  /** 初始化独占根目录。 */
  async initialize(): Promise<void> {
    await mkdir(this.root_path, { recursive: true });
  }

  /** 判断逻辑 key 是否存在。 */
  async has(key: string): Promise<boolean> {
    await this.assert_no_symbolic_links(key, true);
    return await access(this.resolve_key(key)).then(() => true).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
  }

  /** 读取逻辑 key；不存在时返回空。 */
  async read(key: string): Promise<string | null> {
    await this.assert_no_symbolic_links(key, true);
    return await readFile(this.resolve_key(key), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  }

  /** 原子创建或替换逻辑 key。 */
  async write(key: string, content: string): Promise<void> {
    const target_path = this.resolve_key(key);
    await this.assert_no_symbolic_links(key, false);
    await mkdir(path.dirname(target_path), { recursive: true });
    await this.assert_no_symbolic_links(key, true);
    const temporary_path = `${target_path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary_path, String(content || ""), "utf8");
      await rename(temporary_path, target_path);
    } catch (error) {
      await rm(temporary_path, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** 列出逻辑前缀下的全部文本条目。 */
  async list(prefix: string): Promise<MemoryStorageEntry[]> {
    const normalized_prefix = normalize_storage_key(prefix);
    await this.assert_no_symbolic_links(normalized_prefix, true);
    const prefix_path = this.resolve_key(normalized_prefix);
    const files = await list_files_recursively(prefix_path);
    const entries = await Promise.all(files.map(async (file_path) => ({
      key: path.relative(this.root_path, file_path).replace(/\\/g, "/"),
      content: await readFile(file_path, "utf8"),
    })));
    return entries.sort((left, right) => left.key.localeCompare(right.key));
  }

  /** 删除逻辑 key。 */
  async delete(key: string): Promise<void> {
    await this.assert_no_symbolic_links(key, true);
    await rm(this.resolve_key(key), { force: true });
  }

  /** File Adapter 没有长期句柄需要释放。 */
  async dispose(): Promise<void> {}

  /** 把逻辑 key 安全解析到当前独占根目录。 */
  private resolve_key(key: string): string {
    const normalized_key = normalize_storage_key(key);
    const resolved_path = path.resolve(this.root_path, normalized_key);
    const relative_path = path.relative(this.root_path, resolved_path);
    if (
      relative_path === ".."
      || relative_path.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative_path)
    ) {
      throw new Error(`Memory storage key escapes root: ${key}`);
    }
    return resolved_path;
  }

  /** 拒绝 root 内部通过符号链接把逻辑 key 重定向到其他物理位置。 */
  private async assert_no_symbolic_links(
    key: string,
    include_target: boolean,
  ): Promise<void> {
    const segments = normalize_storage_key(key).split("/");
    const segment_count = include_target ? segments.length : Math.max(0, segments.length - 1);
    let current_path = this.root_path;
    for (let index = 0; index < segment_count; index += 1) {
      current_path = path.join(current_path, segments[index] || "");
      const stats = await lstat(current_path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!stats) return;
      if (stats.isSymbolicLink()) {
        throw new Error(`Memory storage key contains symbolic link: ${key}`);
      }
    }
  }
}
