/**
 * 文件工具内部错误。
 *
 * 关键点（中文）
 * - 内部流程通过类型化错误中断，tool 边界再统一转换为结构化失败结果。
 * - 不把 Node.js 原始错误码直接暴露为公共协议。
 */

import type {
  FileEditDetail,
  FileToolErrorCode,
  FileToolFailure,
} from "@/types/workspace/FileTool.js";

/** 文件工具可识别的内部错误。 */
export class FileToolRuntimeError extends Error {
  /** 稳定的公共错误码。 */
  readonly error_code: FileToolErrorCode;
  /** 已完成解析时的目标绝对路径。 */
  readonly file_path?: string;
  /** 编辑失败时的匹配详情。 */
  readonly details?: FileEditDetail[];

  constructor(params: {
    /** 稳定的公共错误码。 */
    error_code: FileToolErrorCode;
    /** 人类可读错误信息。 */
    message: string;
    /** 已完成解析时的目标绝对路径。 */
    file_path?: string;
    /** 编辑失败时的匹配详情。 */
    details?: FileEditDetail[];
  }) {
    super(params.message);
    this.name = "FileToolRuntimeError";
    this.error_code = params.error_code;
    this.file_path = params.file_path;
    this.details = params.details;
  }
}

/** 把内部或 Node.js 错误转换为稳定失败结果。 */
export function to_file_tool_failure(
  error: unknown,
  fallback_file_path?: string,
): FileToolFailure {
  if (error instanceof FileToolRuntimeError) {
    return {
      success: false,
      error_code: error.error_code,
      message: error.message,
      ...(error.file_path || fallback_file_path
        ? { file_path: error.file_path || fallback_file_path }
        : {}),
      ...(error.details ? { details: error.details } : {}),
    };
  }

  const node_error = error as NodeJS.ErrnoException;
  const code = String(node_error?.code || "");
  if (code === "ENOENT") {
    return {
      success: false,
      error_code: "file_not_found",
      message: `File not found: ${fallback_file_path || "unknown path"}`,
      ...(fallback_file_path ? { file_path: fallback_file_path } : {}),
    };
  }
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return {
      success: false,
      error_code: "permission_denied",
      message: `Permission denied: ${fallback_file_path || "unknown path"}`,
      ...(fallback_file_path ? { file_path: fallback_file_path } : {}),
    };
  }
  if (code === "EISDIR") {
    return {
      success: false,
      error_code: "not_a_file",
      message: `Expected a file: ${fallback_file_path || "unknown path"}`,
      ...(fallback_file_path ? { file_path: fallback_file_path } : {}),
    };
  }
  if (code === "EEXIST") {
    return {
      success: false,
      error_code: "file_exists",
      message: `File already exists: ${fallback_file_path || "unknown path"}`,
      ...(fallback_file_path ? { file_path: fallback_file_path } : {}),
    };
  }
  return {
    success: false,
    error_code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
    ...(fallback_file_path ? { file_path: fallback_file_path } : {}),
  };
}
