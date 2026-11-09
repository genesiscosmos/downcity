/**
 * 大文本的有界读取窗口。按原始字节续读，不为页码、总行数或哈希加载整份文件。
 * UTF-8 与带 BOM 的 UTF-16 在编码边界截断；行模式返回相同的字节游标供超长行继续读取。
 */
import { open, constants, type FileHandle } from "node:fs/promises";
import type { ReadFileToolInput, ReadFileToolSuccess } from "@downcity/type/workspace";
import { file_read_version } from "@downcity/type/workspace";
import { detect_text_encoding, normalize_text_to_lf, type SupportedFileEncoding } from "./FileEncoding.js";
import { FileToolRuntimeError } from "./FileToolError.js";

/** 每次给模型的 UTF-8 文本最多 64 KiB。 */
export const MAX_TEXT_WINDOW_BYTES = 64 * 1024;

/** 与显式媒体披露使用相同的源文件版本。 */
export { file_read_version } from "@downcity/type/workspace";

/** 有界读取大文本；传入的文件已经通过路径策略校验。 */
export async function read_text_window(file_path: string, input: ReadFileToolInput, abort_signal?: AbortSignal): Promise<ReadFileToolSuccess> {
  abort_signal?.throwIfAborted();
  if (input.byte_offset !== undefined && (input.offset !== undefined || input.limit !== undefined)) {
    throw new FileToolRuntimeError({ error_code: "invalid_path", message: "byte_offset cannot be combined with offset or limit", file_path });
  }
  const file = await open(file_path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new FileToolRuntimeError({ error_code: "not_a_file", message: "Expected a regular file", file_path });
    const file_version = file_read_version(metadata);
    if (input.expected_version && input.expected_version !== file_version) throw changed_file(file_path);
    const head = Buffer.alloc(512);
    const header = await file.read(head, 0, head.length, 0);
    const encoding = detect_text_encoding(head.subarray(0, header.bytesRead));
    const bom_bytes = encoding !== "utf-8" ? 2 : head.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0;
    const start_byte = input.byte_offset !== undefined ? Math.min(input.byte_offset, metadata.size)
      : await locate_line_start(file, metadata.size, encoding, bom_bytes, input.offset ?? 0, abort_signal);
    if (encoding !== "utf-8" && start_byte % 2) {
      throw new FileToolRuntimeError({ error_code: "encoding_error", message: "UTF-16 byte_offset must be aligned; use next_byte_offset", file_path });
    }
    abort_signal?.throwIfAborted();
    const bytes = Buffer.alloc(MAX_TEXT_WINDOW_BYTES);
    const { bytesRead: bytes_read } = await file.read(bytes, 0, bytes.length, start_byte);
    let raw: string;
    try {
      // stream 保留尾部不完整字符；非 EOF 时下次从最后一个完整字符后继续。
      const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
      raw = decoder.decode(bytes.subarray(0, bytes_read), { stream: start_byte + bytes_read < metadata.size });
    } catch { throw new FileToolRuntimeError({ error_code: "encoding_error", message: `Invalid ${encoding} continuation; use next_byte_offset`, file_path }); }
    const skipped_bom = start_byte === 0 && raw.startsWith("\ufeff") ? bom_bytes : 0;
    if (skipped_bom) raw = raw.slice(1);
    if (input.byte_offset === undefined) {
      const limit = Math.min(2000, Math.max(1, input.limit ?? 500));
      let count = 0;
      for (const match of raw.matchAll(/\r\n|\r|\n/g)) {
        if (++count === limit) { raw = raw.slice(0, match.index! + match[0].length); break; }
      }
    }
    // UTF-16 的 UTF-8 表达可能比原始窗口大，二分截断且保留代理对边界。
    if (Buffer.byteLength(raw, "utf8") > MAX_TEXT_WINDOW_BYTES) {
      let low = 0, high = raw.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(raw.slice(0, middle), "utf8") <= MAX_TEXT_WINDOW_BYTES) low = middle;
        else high = middle - 1;
      }
      if (low && /[\ud800-\udbff]/u.test(raw[low - 1]!)) low--;
      raw = raw.slice(0, low);
    }
    // CRLF 跨页时将 CR 留给下一页，避免规范化后产生两个换行。
    if (raw.endsWith("\r") && start_byte + skipped_bom + (encoding === "utf-8" ? Buffer.byteLength(raw, "utf8") : raw.length * 2) < metadata.size) raw = raw.slice(0, -1);
    const consumed_bytes = encoding === "utf-8" ? Buffer.byteLength(raw, "utf8") : raw.length * 2;
    const next_byte_offset = start_byte + skipped_bom + consumed_bytes;
    if (file_read_version(await file.stat()) !== file_version) throw changed_file(file_path);
    const content = normalize_text_to_lf(raw);
    const start_line = input.byte_offset === undefined ? input.offset ?? 0 : -1;
    const line_count = content ? content.split("\n").length - (content.endsWith("\n") ? 1 : 0) : 0;
    return {
      success: true, file_path, total_bytes: metadata.size, total_lines: null,
      start_line, end_line: start_line < 0 ? -1 : start_line + line_count - 1, content,
      truncated: next_byte_offset < metadata.size,
      ...(next_byte_offset < metadata.size ? { next_byte_offset } : {}),
      start_byte, file_version, type: "text", encoding,
    };
  } finally { await file.close(); }
}

/** 流式查找行起点；只跳过指定前缀，内存不随文件大小增长。 */
async function locate_line_start(file: FileHandle, size: number, encoding: SupportedFileEncoding, bom_bytes: number, target_line: number, abort_signal?: AbortSignal): Promise<number> {
  if (!target_line) return bom_bytes;
  const chunk = Buffer.alloc(MAX_TEXT_WINDOW_BYTES);
  const width = encoding === "utf-8" ? 1 : 2;
  let position = bom_bytes, line = 0, previous_cr = false;
  while (position < size) {
    abort_signal?.throwIfAborted();
    const { bytesRead: bytes_read } = await file.read(chunk, 0, chunk.length, position);
    if (!bytes_read) break;
    for (let index = 0; index + width <= bytes_read; index += width) {
      const unit = width === 1 ? chunk[index]! : encoding === "utf-16le" ? chunk.readUInt16LE(index) : chunk.readUInt16BE(index);
      if (previous_cr) {
        previous_cr = false;
        if (unit === 10) { if (line === target_line) return position + index + width; continue; }
        if (line === target_line) return position + index;
      }
      if (unit === 13 || unit === 10) {
        line++;
        if (unit === 13) previous_cr = true;
        else if (line === target_line) return position + index + width;
      }
    }
    position += bytes_read;
  }
  return size;
}

/** 文件变化时拒绝混合不同快照。 */
function changed_file(file_path: string): FileToolRuntimeError {
  return new FileToolRuntimeError({ error_code: "file_changed", message: "File changed; restart reading with a fresh version", file_path });
}
