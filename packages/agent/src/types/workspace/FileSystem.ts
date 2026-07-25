/**
 * Workspace 文件系统类型。
 *
 * 关键点（中文）
 * - 文件与搜索共享同一个已解析项目根目录。
 * - 接口只表达 Workspace 能力，不包含命令、Session 或 Store。
 */

import type {
  FileToolActionRequest,
  FileToolActionResult,
} from "@/types/workspace/FileTool.js";
import type {
  SearchToolActionRequest,
  SearchToolActionResult,
} from "@/types/workspace/SearchTool.js";

/** Workspace 内统一的文件与搜索能力。 */
export interface FileSystem {
  /** 已解析且不可变的项目根目录。 */
  readonly root_path: string;

  /** 执行一次受项目根目录限制的结构化文件操作。 */
  run_file_action(request: FileToolActionRequest): Promise<FileToolActionResult>;

  /** 执行一次受项目根目录限制的结构化搜索操作。 */
  run_search_action(request: SearchToolActionRequest): Promise<SearchToolActionResult>;
}
