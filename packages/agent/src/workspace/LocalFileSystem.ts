/**
 * LocalFileSystem：基于 Node.js 的本地 Workspace 文件能力。
 *
 * 职责说明（中文）
 * - 为 File/Search Tool 提供单一 rooted 文件边界。
 * - 复用统一路径策略、原子写入、符号链接校验与有界搜索实现。
 * - 不执行任意 Shell 命令，也不感知 Agent、Session 或 Store。
 */

import type { FileSystem } from "@/types/workspace/FileSystem.js";
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

/** Node.js 本地文件系统实现。 */
export class LocalFileSystem implements FileSystem {
  /** 已解析且不可变的项目根目录。 */
  readonly root_path: string;

  constructor(root_path: string) {
    this.root_path = root_path;
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
