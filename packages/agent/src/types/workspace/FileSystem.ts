/**
 * Workspace 文件系统类型。
 *
 * 关键点（中文）
 * - 文件与搜索共享同一个已解析项目根目录。
 * - AgentTools 与 AgentStore 共用这一文件能力，不建立额外存储根目录。
 */

import type {
  FileToolActionRequest,
  FileToolActionResult,
} from "@/types/workspace/FileTool.js";
import type {
  SearchToolActionRequest,
  SearchToolActionResult,
} from "@/types/workspace/SearchTool.js";

/** Workspace 目录中的稳定条目摘要。 */
export interface WorkspaceDirectoryEntry {
  /** 当前条目的原始文件名。 */
  name: string;
  /** 当前条目是否为普通目录。 */
  is_directory: boolean;
  /** 当前条目是否为普通文件。 */
  is_file: boolean;
}

/** Workspace 内统一的文件与搜索能力。 */
export interface FileSystem {
  /** 已解析且不可变的项目根目录。 */
  readonly root_path: string;

  /** 将 Workspace 内的相对路径片段解析为本地绝对路径。 */
  resolve_path(...segments: string[]): string;

  /** 判断 Workspace 内的文件或目录是否存在。 */
  path_exists(file_path: string): Promise<boolean>;

  /** 读取 Workspace 内文件的完整字节内容。 */
  read_file(file_path: string): Promise<Buffer>;

  /** 读取 Workspace 内普通文件的字节大小。 */
  file_size(file_path: string): Promise<number>;

  /** 创建 Workspace 内目录及缺失的父目录。 */
  ensure_directory(directory_path: string): Promise<void>;

  /** 删除 Workspace 内文件或目录；目标不存在时视为成功。 */
  remove_path(target_path: string): Promise<void>;

  /** 原子移动 Workspace 内的文件或目录，不覆盖已有目标。 */
  move_path(source_path: string, target_path: string): Promise<void>;

  /** 读取 Workspace 内目录的直接子条目。 */
  read_directory(directory_path: string): Promise<WorkspaceDirectoryEntry[]>;

  /** 原子创建或覆盖 Workspace 内的完整文件内容。 */
  write_file_atomically(file_path: string, content: string | Buffer): Promise<void>;

  /** 向 Workspace 文件末尾追加完整字节内容。 */
  append_file(file_path: string, content: string | Buffer): Promise<void>;

  /**
   * 使用 Workspace 内的独占锁串行执行文件事务。
   *
   * @param lock_path 锁文件路径；调用完成后由 FileSystem 自动释放。
   * @param action 获得锁后执行的事务；异常会原样向调用方抛出。
   */
  with_file_lock<T>(lock_path: string, action: () => Promise<T>): Promise<T>;

  /** 执行一次受项目根目录限制的结构化文件操作。 */
  run_file_action(request: FileToolActionRequest): Promise<FileToolActionResult>;

  /** 执行一次受项目根目录限制的结构化搜索操作。 */
  run_search_action(request: SearchToolActionRequest): Promise<SearchToolActionResult>;
}
