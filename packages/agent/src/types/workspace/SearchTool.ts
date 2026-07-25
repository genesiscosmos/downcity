/**
 * 项目搜索工具公开类型。
 *
 * 关键点（中文）
 * - `grep` 通过 ripgrep 搜索文件内容，`find` 通过 glob 发现文件。
 * - 模型可见字段统一使用 snake_case，并返回稳定的结构化结果。
 * - 两个工具都受 Shell 项目根目录约束，不允许搜索根目录之外的路径。
 */

import type { Tool } from "ai";

/** 搜索工具支持的结构化错误码。 */
export type SearchToolErrorCode =
  | "invalid_path"
  | "sandbox_denied"
  | "path_not_found"
  | "not_a_directory"
  | "invalid_pattern"
  | "rg_unavailable"
  | "search_failed"
  | "aborted"
  | "internal_error";

/** grep 工具输入。 */
export interface GrepToolInput {
  /** 要搜索的文本或正则表达式。 */
  query: string;
  /** 搜索范围的项目内相对路径或绝对路径，默认为项目根目录。 */
  path?: string;
  /** 用于限制候选文件的 ripgrep glob 模式列表。 */
  glob?: string[];
  /** 是否区分大小写，默认不区分。 */
  case_sensitive?: boolean;
  /** 是否按字面量搜索；设为 false 时把 query 作为 ripgrep 正则表达式。 */
  literal?: boolean;
  /** 本次最多返回的匹配数量，默认 200，最大 2000。 */
  max_results?: number;
}

/** find 工具输入。 */
export interface FindToolInput {
  /** 用于发现文件的 POSIX glob 模式。 */
  pattern: string;
  /** 开始匹配的项目内目录，默认为项目根目录。 */
  path?: string;
  /** 本次最多返回的文件数量，默认 200，最大 2000。 */
  max_results?: number;
}

/** grep 返回的单项内容匹配。 */
export interface GrepToolMatch {
  /** 匹配文件相对于项目根目录的 POSIX 路径。 */
  file_path: string;
  /** 匹配所在的 1-based 行号。 */
  line_number: number;
  /** 匹配起始位置的 1-based UTF-8 字节列号。 */
  column: number;
  /** 匹配所在行的文本预览，不包含行尾换行符。 */
  text: string;
  /** 当前子匹配命中的原始文本。 */
  match_text: string;
  /** 行文本是否因为输出限制而被截断。 */
  line_truncated: boolean;
}

/** 搜索工具统一失败结果。 */
export interface SearchToolFailure {
  /** 表示本次搜索失败。 */
  success: false;
  /** 供模型和调用方稳定解析的错误码。 */
  error_code: SearchToolErrorCode;
  /** 面向模型和日志的人类可读错误信息。 */
  message: string;
  /** 已完成解析时的搜索绝对路径。 */
  search_path?: string;
}

/** grep 工具成功结果。 */
export interface GrepToolSuccess {
  /** 表示本次内容搜索成功。 */
  success: true;
  /** Shell 当前约束的项目根目录绝对路径。 */
  root_path: string;
  /** 实际执行搜索的绝对路径。 */
  search_path: string;
  /** 本次传给 ripgrep 的查询文本。 */
  query: string;
  /** 按 ripgrep 输出顺序返回的内容匹配。 */
  matches: GrepToolMatch[];
  /** ripgrep 实际开始搜索的文件数量。 */
  files_searched: number;
  /** 本次结果中返回的匹配数量。 */
  match_count: number;
  /** 是否因为 max_results 限制而省略了后续匹配。 */
  truncated: boolean;
}

/** find 工具成功结果。 */
export interface FindToolSuccess {
  /** 表示本次文件发现成功。 */
  success: true;
  /** Shell 当前约束的项目根目录绝对路径。 */
  root_path: string;
  /** 实际开始 glob 匹配的绝对目录。 */
  search_path: string;
  /** 本次执行的 glob 模式。 */
  pattern: string;
  /** 排序后返回的项目相对 POSIX 文件路径。 */
  files: string[];
  /** 本次结果中返回的文件数量。 */
  match_count: number;
  /** 是否因为 max_results 限制而省略了后续文件。 */
  truncated: boolean;
}

/** grep 工具结果。 */
export type GrepToolResult = GrepToolSuccess | SearchToolFailure;

/** find 工具结果。 */
export type FindToolResult = FindToolSuccess | SearchToolFailure;

/** 搜索 action 的判别式请求。 */
export type SearchToolActionRequest = (
  | {
      /** 指定执行内容搜索。 */
      action: "grep";
      /** grep 工具输入。 */
      input: GrepToolInput;
    }
  | {
      /** 指定执行文件发现。 */
      action: "find";
      /** find 工具输入。 */
      input: FindToolInput;
    }
) & {
  /** AI SDK 传入的单次工具调用中止信号。 */
  abort_signal?: AbortSignal;
};

/** 搜索 action 的统一结果。 */
export type SearchToolActionResult = GrepToolResult | FindToolResult;

/** 搜索工具运行器协议。 */
export interface SearchToolRunner {
  /** 执行一个独立的搜索 action。 */
  run_search_action(request: SearchToolActionRequest): Promise<SearchToolActionResult>;
}

/** `@downcity/shell` 对模型暴露的项目搜索工具集合。 */
export interface SearchToolSet {
  /** 通过 ripgrep 搜索项目文件内容。 */
  grep: Tool;
  /** 通过 glob 模式发现项目文件。 */
  find: Tool;
}
