/**
 * LocalFileSystem：基于 Node.js 的本地 Workspace 文件能力。
 *
 * 职责说明（中文）
 * - 为 File/Search Tool 提供单一 rooted 文件边界。
 * - 复用统一路径策略、原子写入、符号链接校验与有界搜索实现。
 * - 不执行任意 Shell 命令，也不感知 Agent、Session 或 Store。
 */

import type {
  FileSystem,
  WorkspaceDirectoryEntry,
} from "@/types/workspace/FileSystem.js";
import type {
  FileToolActionRequest,
  FileToolActionResult,
} from "@/types/workspace/FileTool.js";
import type {
  SearchToolActionRequest,
  SearchToolActionResult,
} from "@/types/workspace/SearchTool.js";
import { run_file_action } from "@/workspace/file/FileActionRuntime.js";
import { run_search_action } from "@/workspace/search/SearchActionRuntime.js";
import path from "node:path";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { write_file_atomically } from "@/workspace/file/FileAtomicWriter.js";

/** Node.js 本地文件系统实现。 */
export class LocalFileSystem implements FileSystem {
  /** 已解析且不可变的项目根目录。 */
  readonly root_path: string;

  constructor(root_path: string) {
    this.root_path = root_path;
  }

  /** 将相对路径安全解析到当前 Workspace 根目录。 */
  resolve_path(...segments: string[]): string {
    const resolved_path = path.resolve(this.root_path, ...segments);
    const relative_path = path.relative(this.root_path, resolved_path);
    if (
      relative_path === ".." ||
      relative_path.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative_path)
    ) {
      throw new Error(`Path escapes Workspace: ${segments.join(path.sep)}`);
    }
    return resolved_path;
  }

  /** 判断 Workspace 路径是否存在。 */
  async path_exists(file_path: string): Promise<boolean> {
    return await access(this.resolve_path(file_path))
      .then(() => true)
      .catch(() => false);
  }

  /** 读取 Workspace 文件的完整字节内容。 */
  async read_file(file_path: string): Promise<Buffer> {
    return await readFile(this.resolve_path(file_path));
  }

  /** 创建目录及缺失的父目录。 */
  async ensure_directory(directory_path: string): Promise<void> {
    await mkdir(this.resolve_path(directory_path), { recursive: true });
  }

  /** 递归删除文件或目录；不存在时保持幂等。 */
  async remove_path(target_path: string): Promise<void> {
    await rm(this.resolve_path(target_path), { recursive: true, force: true });
  }

  /** 使用同一 Workspace 文件系统内的 rename 原子移动路径。 */
  async move_path(source_path: string, target_path: string): Promise<void> {
    await rename(
      this.resolve_path(source_path),
      this.resolve_path(target_path),
    );
  }

  /** 返回目录直接子项的最小稳定结构。 */
  async read_directory(
    directory_path: string,
  ): Promise<WorkspaceDirectoryEntry[]> {
    const entries = await readdir(this.resolve_path(directory_path), {
      withFileTypes: true,
    });
    return entries.map((entry) => ({
      name: entry.name,
      is_directory: entry.isDirectory(),
      is_file: entry.isFile(),
    }));
  }

  /** 使用同目录临时文件与 fsync 原子覆盖 Workspace 文件。 */
  async write_file_atomically(
    file_path: string,
    content: string | Buffer,
  ): Promise<void> {
    const resolved_path = this.resolve_path(file_path);
    await mkdir(path.dirname(resolved_path), { recursive: true });
    const mode = await stat(resolved_path)
      .then((value) => value.mode)
      .catch(() => undefined);
    await write_file_atomically({
      file_path: resolved_path,
      content: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"),
      overwrite: true,
      ...(typeof mode === "number" ? { mode } : {}),
    });
  }

  /** 执行一次结构化文件操作。 */
  async run_file_action(
    request: FileToolActionRequest,
  ): Promise<FileToolActionResult> {
    return await run_file_action({ rootPath: this.root_path }, request);
  }

  /** 执行一次结构化搜索操作。 */
  async run_search_action(
    request: SearchToolActionRequest,
  ): Promise<SearchToolActionResult> {
    return await run_search_action({ rootPath: this.root_path }, request);
  }
}
