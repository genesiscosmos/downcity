/**
 * 文件 action 运行时。
 *
 * 关键点（中文）
 * - 三个 action 共用项目根目录校验、编码识别和结构化错误协议。
 * - write/edit 都通过同目录临时文件实现原子替换。
 * - edit 的全部匹配基于原始文件，并从后向前一次应用。
 */

import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  EditFileToolInput,
  EditFileToolResult,
  FileEditDetail,
  FileToolActionRequest,
  FileToolActionResult,
  ReadFileToolInput,
  ReadFileToolResult,
  WriteFileToolInput,
  WriteFileToolResult,
} from "@/types/workspace/FileTool.js";
import { resolve_file_tool_path } from "@/workspace/file/FilePathPolicy.js";
import { FileToolRuntimeError, to_file_tool_failure } from "@/workspace/file/FileToolError.js";
import {
  count_text_lines,
  create_file_sha256,
  decode_text_file,
  detect_file_mime_type,
  detect_image_file_mime_type,
  encode_text_file,
  is_binary_file,
  normalize_text_to_lf,
} from "@/workspace/file/FileEncoding.js";
import { write_file_atomically } from "@/workspace/file/FileAtomicWriter.js";

const DEFAULT_READ_LINES = 500;
const MAX_READ_LINES = 2_000;
const MAX_READ_OUTPUT_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_EDITS = 10;
const MAX_OLD_TEXT_CHARS = 10_000;
const MAX_NEW_TEXT_CHARS = 50_000;

/** 判断文件是否存在。 */
async function file_exists(file_path: string): Promise<boolean> {
  try {
    await lstat(file_path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 在内存读取前限制单文件大小。 */
async function read_limited_file(file_path: string): Promise<Buffer> {
  const metadata = await lstat(file_path);
  if (metadata.size > MAX_FILE_BYTES) {
    throw new FileToolRuntimeError({
      error_code: "file_too_large",
      message: `File exceeds ${MAX_FILE_BYTES} byte processing limit: ${file_path}`,
      file_path,
    });
  }
  return await readFile(file_path);
}

/** 把文本拆为稳定的逻辑行。 */
function split_text_lines(content: string): string[] {
  if (content.length === 0) return [];
  const normalized = normalize_text_to_lf(content);
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
}

/** 执行文件读取。 */
async function read_file_action(
  context: { readonly rootPath: string },
  input: ReadFileToolInput,
): Promise<ReadFileToolResult> {
  let file_path = "";
  try {
    const resolved = await resolve_file_tool_path({
      root_path: context.rootPath,
      file_path: input.file_path,
      allow_missing: false,
    });
    file_path = resolved.file_path;
    const buffer = await read_limited_file(file_path);
    const total_bytes = buffer.byteLength;
    const sha256 = create_file_sha256(buffer);
    const image_mime_type = detect_image_file_mime_type(buffer);
    if (image_mime_type) {
      return {
        success: true,
        file_path,
        total_bytes,
        total_lines: 0,
        start_line: 0,
        end_line: -1,
        content: "",
        truncated: false,
        type: "image",
        mime_type: image_mime_type,
        sha256,
      };
    }
    const mime_type = detect_file_mime_type(file_path);
    if (is_binary_file(buffer)) {
      return {
        success: true,
        file_path,
        total_bytes,
        total_lines: 0,
        start_line: 0,
        end_line: -1,
        content: "",
        truncated: false,
        type: "binary",
        ...(mime_type ? { mime_type } : {}),
        sha256,
      };
    }

    const decoded = decode_text_file(buffer);
    const lines = split_text_lines(decoded.content);
    const total_lines = lines.length;
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.min(
      MAX_READ_LINES,
      Math.max(1, Math.floor(input.limit ?? DEFAULT_READ_LINES)),
    );
    const selected_lines: string[] = [];
    let output_bytes = 0;
    const requested_end = Math.min(total_lines, offset + limit);
    for (let index = offset; index < requested_end; index += 1) {
      const line = lines[index] ?? "";
      const separator_bytes = selected_lines.length > 0 ? 1 : 0;
      const line_bytes = Buffer.byteLength(line, "utf8") + separator_bytes;
      if (selected_lines.length === 0 && line_bytes > MAX_READ_OUTPUT_BYTES) {
        throw new FileToolRuntimeError({
          error_code: "line_too_large",
          message: `Line ${index} exceeds the ${MAX_READ_OUTPUT_BYTES} byte read limit`,
          file_path,
        });
      }
      if (output_bytes + line_bytes > MAX_READ_OUTPUT_BYTES) break;
      selected_lines.push(line);
      output_bytes += line_bytes;
    }

    const start_line = offset;
    const end_line = selected_lines.length > 0
      ? offset + selected_lines.length - 1
      : offset - 1;
    const truncated = end_line + 1 < total_lines;
    return {
      success: true,
      file_path,
      total_bytes,
      total_lines,
      start_line,
      end_line,
      content: selected_lines.join("\n"),
      truncated,
      ...(truncated ? { next_offset: end_line + 1 } : {}),
      type: "text",
      ...(mime_type ? { mime_type } : {}),
      encoding: decoded.encoding,
      sha256,
    };
  } catch (error) {
    return to_file_tool_failure(error, file_path || undefined);
  }
}

/** 执行文件写入。 */
async function write_file_action(
  context: { readonly rootPath: string },
  input: WriteFileToolInput,
): Promise<WriteFileToolResult> {
  let file_path = "";
  try {
    const resolved = await resolve_file_tool_path({
      root_path: context.rootPath,
      file_path: input.file_path,
      allow_missing: true,
    });
    file_path = resolved.file_path;
    const normalized_content = normalize_text_to_lf(input.content);
    const content = Buffer.from(normalized_content, "utf8");
    if (content.byteLength > MAX_WRITE_BYTES) {
      throw new FileToolRuntimeError({
        error_code: "content_too_large",
        message: `Write content exceeds ${MAX_WRITE_BYTES} bytes`,
        file_path,
      });
    }
    const existed = await file_exists(file_path);
    if (existed && input.overwrite !== true) {
      throw new FileToolRuntimeError({
        error_code: "file_exists",
        message: `File already exists; pass overwrite=true to replace it: ${file_path}`,
        file_path,
      });
    }
    const mode = existed ? (await lstat(file_path)).mode & 0o7777 : undefined;
    await mkdir(path.dirname(file_path), { recursive: true });
    await write_file_atomically({
      file_path,
      content,
      overwrite: existed,
      ...(typeof mode === "number" ? { mode } : {}),
    });
    return {
      success: true,
      file_path,
      bytes_written: content.byteLength,
      lines_written: count_text_lines(normalized_content),
      overwritten: existed,
      timestamp: new Date().toISOString(),
      sha256: create_file_sha256(content),
    };
  } catch (error) {
    return to_file_tool_failure(error, file_path || undefined);
  }
}

/** 返回字面量在文本中的全部起始位置，包含潜在重叠匹配。 */
function find_literal_matches(content: string, target: string): number[] {
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= content.length - target.length) {
    const position = content.indexOf(target, cursor);
    if (position < 0) break;
    matches.push(position);
    cursor = position + 1;
  }
  return matches;
}

/** 识别原文件使用的主要换行符。 */
function detect_text_eol(content: string): "\n" | "\r\n" | "\r" {
  if (content.includes("\r\n")) return "\r\n";
  if (content.includes("\r")) return "\r";
  return "\n";
}

/** 把编辑文本适配为原文件的主要换行符。 */
function normalize_edit_eol(content: string, eol: "\n" | "\r\n" | "\r"): string {
  return normalize_text_to_lf(content).replace(/\n/g, eol);
}

/** 计算字符位置对应的 0-based 行号。 */
function resolve_line_number(content: string, position: number): number {
  return count_text_lines(content.slice(0, position));
}

/** 执行文件精确编辑。 */
async function edit_file_action(
  context: { readonly rootPath: string },
  input: EditFileToolInput,
): Promise<EditFileToolResult> {
  let file_path = "";
  try {
    const resolved = await resolve_file_tool_path({
      root_path: context.rootPath,
      file_path: input.file_path,
      allow_missing: false,
    });
    file_path = resolved.file_path;
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      throw new FileToolRuntimeError({
        error_code: "no_edits",
        message: "edits must contain at least one operation",
        file_path,
      });
    }
    if (input.edits.length > MAX_EDITS) {
      throw new FileToolRuntimeError({
        error_code: "too_many_edits",
        message: `A single edit call supports at most ${MAX_EDITS} operations`,
        file_path,
      });
    }
    for (const edit of input.edits) {
      if (
        edit.old_text.length === 0 ||
        edit.old_text.length > MAX_OLD_TEXT_CHARS ||
        edit.new_text.length > MAX_NEW_TEXT_CHARS
      ) {
        throw new FileToolRuntimeError({
          error_code: "edit_too_large",
          message: `Each old_text must contain 1-${MAX_OLD_TEXT_CHARS} characters and new_text at most ${MAX_NEW_TEXT_CHARS} characters`,
          file_path,
        });
      }
    }

    const buffer = await read_limited_file(file_path);
    if (is_binary_file(buffer)) {
      throw new FileToolRuntimeError({
        error_code: "binary_file",
        message: `Cannot edit a binary file: ${file_path}`,
        file_path,
      });
    }
    const previous_sha256 = create_file_sha256(buffer);
    const expected_sha256 = String(input.expected_sha256 || "").trim().toLowerCase();
    if (expected_sha256 && expected_sha256 !== previous_sha256) {
      throw new FileToolRuntimeError({
        error_code: "file_changed",
        message: `File changed since it was read: ${file_path}`,
        file_path,
      });
    }

    const decoded = decode_text_file(buffer);
    const original_content = decoded.content;
    const eol = detect_text_eol(original_content);
    const matches = input.edits.map((edit, index) => {
      const old_text = normalize_edit_eol(edit.old_text, eol);
      const new_text = normalize_edit_eol(edit.new_text, eol);
      const positions = find_literal_matches(original_content, old_text);
      const detail: FileEditDetail = {
        index,
        status:
          positions.length === 0
            ? "not_found"
            : positions.length > 1
              ? "duplicate"
              : "applied",
        match_count: positions.length,
        ...(positions.length === 1
          ? { line_start: resolve_line_number(original_content, positions[0]) }
          : {}),
      };
      return {
        index,
        old_text,
        new_text,
        start: positions[0] ?? -1,
        end: positions.length === 1 ? positions[0] + old_text.length : -1,
        detail,
      };
    });
    const invalid_match = matches.find((item) => item.detail.status !== "applied");
    if (invalid_match) {
      throw new FileToolRuntimeError({
        error_code:
          invalid_match.detail.status === "duplicate"
            ? "duplicate_match"
            : "not_found",
        message:
          invalid_match.detail.status === "duplicate"
            ? `edits[${invalid_match.index}].old_text matched ${invalid_match.detail.match_count} times`
            : `edits[${invalid_match.index}].old_text was not found`,
        file_path,
        details: matches.map((item) => item.detail),
      });
    }

    const sorted_matches = [...matches].sort((left, right) => left.start - right.start);
    for (let index = 0; index < sorted_matches.length - 1; index += 1) {
      if (sorted_matches[index].end > sorted_matches[index + 1].start) {
        throw new FileToolRuntimeError({
          error_code: "overlapping_edits",
          message: "Edit regions overlap; merge nearby changes into one edit",
          file_path,
          details: matches.map((item) => item.detail),
        });
      }
    }

    let next_content = original_content;
    for (const match of [...sorted_matches].reverse()) {
      next_content =
        next_content.slice(0, match.start) +
        match.new_text +
        next_content.slice(match.end);
    }
    const next_buffer = encode_text_file(next_content, decoded.encoding);
    if (next_buffer.byteLength > MAX_FILE_BYTES) {
      throw new FileToolRuntimeError({
        error_code: "content_too_large",
        message: `Edited file exceeds ${MAX_FILE_BYTES} bytes`,
        file_path,
      });
    }
    const mode = (await lstat(file_path)).mode & 0o7777;
    await write_file_atomically({
      file_path,
      content: next_buffer,
      overwrite: true,
      mode,
    });
    return {
      success: true,
      file_path,
      applied: matches.length,
      details: matches.map((item) => item.detail),
      new_total_lines: count_text_lines(next_content),
      previous_sha256,
      sha256: create_file_sha256(next_buffer),
    };
  } catch (error) {
    return to_file_tool_failure(error, file_path || undefined);
  }
}

/** 执行一个文件 action。 */
export async function run_file_action(
  context: { readonly rootPath: string },
  request: FileToolActionRequest,
): Promise<FileToolActionResult> {
  switch (request.action) {
    case "read":
      return await read_file_action(context, request.input);
    case "write":
      return await write_file_action(context, request.input);
    case "edit":
      return await edit_file_action(context, request.input);
    default:
      return {
        success: false,
        error_code: "internal_error",
        message: `Unknown file action: ${String((request as { action?: unknown }).action)}`,
      };
  }
}
