/**
 * 文件内容检测与编码辅助。
 *
 * 关键点（中文）
 * - 二进制检测只把 NUL 和低位控制字符视为高风险，避免误判 UTF-8 中文。
 * - 文本解码使用 fatal 模式，禁止静默插入替换字符。
 * - 第一版仅接受 UTF-8 和带 BOM 的 UTF-16 文本。
 */

import crypto from "node:crypto";
import path from "node:path";
import { FileToolRuntimeError } from "@/workspace/file/FileToolError.js";

const BINARY_SAMPLE_BYTES = 512;

/** 支持的文本编码。 */
export type SupportedFileEncoding = "utf-8" | "utf-16le" | "utf-16be";

/** 计算文件内容的 SHA-256。 */
export function create_file_sha256(content: Uint8Array | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** 根据 BOM 判断文本编码。 */
export function detect_text_encoding(buffer: Buffer): SupportedFileEncoding {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf-16le";
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return "utf-16be";
  }
  return "utf-8";
}

/** 保守判断一个文件是否为二进制。 */
export function is_binary_file(buffer: Buffer): boolean {
  const encoding = detect_text_encoding(buffer);
  if (encoding !== "utf-8") return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SAMPLE_BYTES));
  if (sample.includes(0)) return true;
  if (sample.length === 0) return false;
  let control_bytes = 0;
  for (const byte of sample) {
    if ((byte < 7 || (byte > 13 && byte < 32)) && byte !== 0) {
      control_bytes += 1;
    }
  }
  return control_bytes / sample.length > 0.3;
}

/** 根据文件签名识别模型可直接读取的静态图片 MIME。 */
export function detect_image_file_mime_type(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const header = buffer.subarray(0, 6).toString("ascii");
  if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 2 &&
    buffer[0] === 0x42 &&
    buffer[1] === 0x4d
  ) {
    return "image/bmp";
  }
  return undefined;
}

/** 严格解码文本文件。 */
export function decode_text_file(buffer: Buffer): {
  /** 解码后的文本。 */
  content: string;
  /** 实际采用的文本编码。 */
  encoding: SupportedFileEncoding;
} {
  const encoding = detect_text_encoding(buffer);
  try {
    const decoder = new TextDecoder(encoding, { fatal: true });
    return {
      content: decoder.decode(buffer),
      encoding,
    };
  } catch {
    throw new FileToolRuntimeError({
      error_code: "encoding_error",
      message: `File is not valid ${encoding} text`,
    });
  }
}

/** 按原文本编码重新编码内容，并保留 UTF-16 BOM。 */
export function encode_text_file(
  content: string,
  encoding: SupportedFileEncoding,
): Buffer {
  if (encoding === "utf-8") return Buffer.from(content, "utf8");
  const utf16le_content = Buffer.from(content, "utf16le");
  if (encoding === "utf-16le") {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le_content]);
  }
  const utf16be_content = Buffer.from(utf16le_content);
  for (let index = 0; index + 1 < utf16be_content.length; index += 2) {
    const first_byte = utf16be_content[index];
    utf16be_content[index] = utf16be_content[index + 1];
    utf16be_content[index + 1] = first_byte;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be_content]);
}

/** 把调用方文本统一为 LF 换行。 */
export function normalize_text_to_lf(content: string): string {
  return content.replace(/\r\n|\r/g, "\n");
}

/** 统计可见文本行数，不把尾随换行后的空位置计为新行。 */
export function count_text_lines(content: string): number {
  if (content.length === 0) return 0;
  const normalized = normalize_text_to_lf(content);
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines.length;
}

/** 根据扩展名识别常见 MIME 类型。 */
export function detect_file_mime_type(file_path: string): string | undefined {
  const extension = path.extname(file_path).toLowerCase();
  const by_extension: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".mdx": "text/mdx",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/tsx",
    ".jsx": "text/jsx",
    ".css": "text/css",
    ".html": "text/html",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".csv": "text/csv",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
  };
  return by_extension[extension];
}
