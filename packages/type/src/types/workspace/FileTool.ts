/**
 * 文件工具公开类型。
 *
 * 关键点（中文）
 * - 文件工具由 Workspace 持有，与 Shell/PTY action 分离。
 * - 所有模型可见字段统一使用 snake_case。
 * - 成功与失败均返回结构化结果，避免依赖异常文本判断执行状态。
 */

import type { AgentTool } from "@downcity/type";
import type { WorkspaceFileMutationObserver } from "./WorkspaceFileMutation.js";

/** 文件工具支持的结构化错误码。 */
export type FileToolErrorCode =
  | "invalid_path"
  | "sandbox_denied"
  | "file_not_found"
  | "not_a_file"
  | "permission_denied"
  | "file_exists"
  | "file_too_large"
  | "content_too_large"
  | "line_too_large"
  | "media_too_large"
  | "encoding_error"
  | "binary_file"
  | "no_edits"
  | "too_many_edits"
  | "duplicate_match"
  | "not_found"
  | "overlapping_edits"
  | "edit_too_large"
  | "file_changed"
  | "internal_error";

/** 文件读取工具输入。 */
export interface ReadFileToolInput {
  /** 要读取的项目内相对路径或绝对路径。 */
  file_path: string;
  /** 从第几行开始读取，使用 0-based 行号。 */
  offset?: number;
  /** 本次最多返回的行数。 */
  limit?: number;
  /** 原始文件的字节起点；与 offset、limit 互斥，用于超长行续读。 */
  byte_offset?: number;
  /** 上次 read 返回的文件版本；不一致时拒绝续读，避免混合不同文件内容。 */
  expected_version?: string;
}

/** 文件写入工具输入。 */
export interface WriteFileToolInput {
  /** 要创建或覆盖的项目内相对路径或绝对路径。 */
  file_path: string;
  /** 要写入的 UTF-8 文本内容。 */
  content: string;
  /** 文件存在时是否允许覆盖，默认不允许。 */
  overwrite?: boolean;
}

/** 单项精确文本编辑。 */
export interface FileEditOperation {
  /** 必须在原文件中唯一匹配的原始文本。 */
  old_text: string;
  /** 用于替换唯一匹配区域的新文本。 */
  new_text: string;
}

/** 文件编辑工具输入。 */
export interface EditFileToolInput {
  /** 要编辑的项目内相对路径或绝对路径。 */
  file_path: string;
  /** 一次原子应用的精确文本编辑列表。 */
  edits: FileEditOperation[];
  /** 可选的读取时 SHA-256；文件变化后拒绝编辑。 */
  expected_sha256?: string;
}

/** 文件工具统一失败结果。 */
export interface FileToolFailure {
  /** 表示本次文件操作失败。 */
  success: false;
  /** 供模型和调用方稳定解析的错误码。 */
  error_code: FileToolErrorCode;
  /** 面向模型和日志的人类可读错误信息。 */
  message: string;
  /** 已完成解析时的目标绝对路径。 */
  file_path?: string;
  /** 编辑失败时每项匹配的详细结果。 */
  details?: FileEditDetail[];
}

/** 文件读取成功结果。 */
export interface ReadFileToolSuccess {
  /** 表示本次文件读取成功。 */
  success: true;
  /** 解析并校验后的目标绝对路径。 */
  file_path: string;
  /** 原始文件总字节数。 */
  total_bytes: number;
  /** 已完整扫描的文本总行数；有界分段未扫描全文件时为 null，媒体为 0。 */
  total_lines: number | null;
  /** 行模式的 0-based 起始行；字节模式不扫描前缀，未知时为 -1。 */
  start_line: number;
  /** 行模式的 0-based 结束行；字节模式未知时为 -1，没有返回行时小于 start_line。 */
  end_line: number;
  /** 返回给模型的文本内容；图片和其他二进制文件为空字符串。 */
  content: string;
  /** 是否还有后续文本行未返回。 */
  truncated: boolean;
  /** 有后续文本时建议下一次使用的 offset。 */
  next_offset?: number;
  /** 存在未披露字节时可直接用于下一次 read 的原始字节位置。 */
  next_byte_offset?: number;
  /** 本次披露文本开始的原始字节位置，分段读取时提供。 */
  start_byte?: number;
  /** 源文件的稳定元信息版本，续读时通过 expected_version 校验。 */
  file_version?: string;
  /** 当前文件被识别为文本、图片还是其他二进制文件。 */
  type: "text" | "image" | "binary";
  /** 当前文件的 MIME 类型。 */
  mime_type?: string;
  /** 文本文件实际采用的解码格式。 */
  encoding?: "utf-8" | "utf-16le" | "utf-16be";
  /** 完整读取时的 SHA-256；分段读取只返回 file_version，不为哈希读取全文。 */
  sha256?: string;
}

/** 文件写入成功结果。 */
export interface WriteFileToolSuccess {
  /** 表示本次文件写入成功。 */
  success: true;
  /** 解析并校验后的目标绝对路径。 */
  file_path: string;
  /** 实际写入的 UTF-8 字节数。 */
  bytes_written: number;
  /** 实际写入的文本行数。 */
  lines_written: number;
  /** 本次操作是否覆盖了已有文件。 */
  overwritten: boolean;
  /** 写入完成后的 ISO 时间戳。 */
  timestamp: string;
  /** 写入后文件内容的 SHA-256。 */
  sha256: string;
}

/** 单项编辑匹配详情。 */
export interface FileEditDetail {
  /** 当前编辑项的原始索引。 */
  index: number;
  /** 当前编辑项的匹配与应用状态。 */
  status: "applied" | "not_found" | "duplicate";
  /** 当前 old_text 在原文件中的匹配次数。 */
  match_count: number;
  /** 唯一匹配成功时的 0-based 起始行。 */
  line_start?: number;
}

/** 文件编辑成功结果。 */
export interface EditFileToolSuccess {
  /** 表示全部编辑已原子应用。 */
  success: true;
  /** 解析并校验后的目标绝对路径。 */
  file_path: string;
  /** 成功应用的编辑数量。 */
  applied: number;
  /** 每项编辑的匹配与应用详情。 */
  details: FileEditDetail[];
  /** 编辑后文件的总行数。 */
  new_total_lines: number;
  /** 编辑前文件内容的 SHA-256。 */
  previous_sha256: string;
  /** 编辑后文件内容的 SHA-256。 */
  sha256: string;
}

/** 文件读取工具结果。 */
export type ReadFileToolResult = ReadFileToolSuccess | FileToolFailure;

/** 文件写入工具结果。 */
export type WriteFileToolResult = WriteFileToolSuccess | FileToolFailure;

/** 文件编辑工具结果。 */
export type EditFileToolResult = EditFileToolSuccess | FileToolFailure;

/** 文件工具内部 action 名称。 */
export type FileToolAction = "read" | "write" | "edit";

/** 文件 action 的判别式请求。 */
export type FileToolActionRequest =
  | {
      /** 指定执行文件读取。 */
      action: "read";
      /** 文件读取输入。 */
      input: ReadFileToolInput;
    }
  | {
      /** 指定执行文件写入。 */
      action: "write";
      /** 文件写入输入。 */
      input: WriteFileToolInput;
    }
  | {
      /** 指定执行文件编辑。 */
      action: "edit";
      /** 文件编辑输入。 */
      input: EditFileToolInput;
    };

/** 文件 action 的统一结果。 */
export type FileToolActionResult =
  | ReadFileToolResult
  | WriteFileToolResult
  | EditFileToolResult;

/** 文件工具运行器协议。 */
export interface FileToolRunner {
  /** 执行一个独立文件 action。 */
  run_file_action(
    request: FileToolActionRequest,
    observer?: WorkspaceFileMutationObserver,
    /** 工具调用取消信号；读取前及文本扫描的块边界检查。 */
    abort_signal?: AbortSignal,
  ): Promise<FileToolActionResult>;
}

/** `@downcity/city/workspace` 对模型暴露的文件工具集合。 */
export interface FileToolSet {
  /** 分页读取文本并识别二进制文件。 */
  read: AgentTool;
  /** 创建或显式覆盖 UTF-8 文本文件。 */
  write: AgentTool;
  /** 通过唯一文本匹配原子编辑单个文件。 */
  edit: AgentTool;
}

/** 已通过项目根目录约束的文件工具路径。 */
export interface ResolvedFileToolPath {
  /** 解析后的目标绝对路径。 */
  file_path: string;
  /** 解析后的项目根目录绝对路径。 */
  root_path: string;
}
