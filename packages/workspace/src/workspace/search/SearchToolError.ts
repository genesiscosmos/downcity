/**
 * 搜索工具内部错误。
 *
 * 关键点（中文）
 * - 搜索运行时使用类型化错误中断，tool 边界统一转换为结构化失败结果。
 * - 文件路径策略产生的错误会映射为搜索工具自己的稳定错误码。
 */

import { FileToolRuntimeError } from "@/workspace/file/FileToolError.js";
import type {
  SearchToolErrorCode,
  SearchToolFailure,
} from "@/types/workspace/SearchTool.js";

/** 搜索工具可识别的内部错误。 */
export class SearchToolRuntimeError extends Error {
  /** 稳定的公共错误码。 */
  readonly error_code: SearchToolErrorCode;
  /** 已完成解析时的搜索绝对路径。 */
  readonly search_path?: string;

  constructor(params: {
    /** 稳定的公共错误码。 */
    error_code: SearchToolErrorCode;
    /** 人类可读错误信息。 */
    message: string;
    /** 已完成解析时的搜索绝对路径。 */
    search_path?: string;
  }) {
    super(params.message);
    this.name = "SearchToolRuntimeError";
    this.error_code = params.error_code;
    this.search_path = params.search_path;
  }
}

/** 把内部、文件路径或 Node.js 错误转换为稳定失败结果。 */
export function to_search_tool_failure(
  error: unknown,
  fallback_search_path?: string,
): SearchToolFailure {
  if (error instanceof SearchToolRuntimeError) {
    return {
      success: false,
      error_code: error.error_code,
      message: error.message,
      ...(error.search_path || fallback_search_path
        ? { search_path: error.search_path || fallback_search_path }
        : {}),
    };
  }
  if (error instanceof FileToolRuntimeError) {
    const error_code: SearchToolErrorCode = error.error_code === "file_not_found"
      ? "path_not_found"
      : error.error_code === "sandbox_denied"
        ? "sandbox_denied"
        : error.error_code === "invalid_path"
          ? "invalid_path"
          : "search_failed";
    return {
      success: false,
      error_code,
      message: error.message,
      ...(error.file_path || fallback_search_path
        ? { search_path: error.file_path || fallback_search_path }
        : {}),
    };
  }

  const node_error = error as NodeJS.ErrnoException;
  const code = String(node_error?.code || "");
  if (code === "ENOENT") {
    return {
      success: false,
      error_code: "path_not_found",
      message: `Search path not found: ${fallback_search_path || "unknown path"}`,
      ...(fallback_search_path ? { search_path: fallback_search_path } : {}),
    };
  }
  if (code === "EACCES" || code === "EPERM") {
    return {
      success: false,
      error_code: "search_failed",
      message: `Permission denied: ${fallback_search_path || "unknown path"}`,
      ...(fallback_search_path ? { search_path: fallback_search_path } : {}),
    };
  }
  return {
    success: false,
    error_code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
    ...(fallback_search_path ? { search_path: fallback_search_path } : {}),
  };
}
