/**
 * 文件工具公开类型。
 *
 * 关键点（中文）
 * - 文件工具由 `@downcity/shell` 持有，与 PTY shell action 分离。
 * - 所有模型可见字段统一使用 snake_case。
 * - 成功与失败均返回结构化结果，避免依赖异常文本判断执行状态。
 */

import type { Tool } from "ai";

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
  /** 文本文件总行数；图片和其他二进制文件固定为 0。 */
  total_lines: number;
  /** 本次返回内容的 0-based 起始行。 */
  start_line: number;
  /** 本次返回内容的 0-based 结束行；没有返回行时小于 start_line。 */
  end_line: number;
  /** 返回给模型的文本内容；图片和其他二进制文件为空字符串。 */
  content: string;
  /** 是否还有后续文本行未返回。 */
  truncated: boolean;
  /** 有后续文本时建议下一次使用的 offset。 */
  next_offset?: number;
  /** 当前文件被识别为文本、图片还是其他二进制文件。 */
  type: "text" | "image" | "binary";
  /** 当前文件的 MIME 类型。 */
  mime_type?: string;
  /** 图片文件读取后生成的 data URL，仅图片结果存在。 */
  data_url?: string;
  /** 图片是否已经作为 UserMessage file part 注入下一模型 step。 */
  image_attached?: boolean;
  /** 文本文件实际采用的解码格式。 */
  encoding?: "utf-8" | "utf-16le" | "utf-16be";
  /** 原始文件内容的 SHA-256，可传给 edit 防止并发覆盖。 */
  sha256: string;
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
  run_file_action(request: FileToolActionRequest): Promise<FileToolActionResult>;
}

/** `@downcity/shell` 对模型暴露的文件工具集合。 */
export interface FileToolSet {
  /** 分页读取文本并识别二进制文件。 */
  read: Tool;
  /** 创建或显式覆盖 UTF-8 文本文件。 */
  write: Tool;
  /** 通过唯一文本匹配原子编辑单个文件。 */
  edit: Tool;
}

/** 已通过项目根目录约束的文件工具路径。 */
export interface ResolvedFileToolPath {
  /** 解析后的目标绝对路径。 */
  file_path: string;
  /** 解析后的项目根目录绝对路径。 */
  root_path: string;
}
