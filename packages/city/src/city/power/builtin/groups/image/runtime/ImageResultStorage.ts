/**
 * Image capability 生成结果本地化。
 *
 * 关键点（中文）
 * - 远端 URL 与内联 data URL 都会落到当前 capability 私有目录，动作只返回本地路径。
 * - File Part 的 `url` 最终是稳定的本地绝对路径，模型上下文里不出现 base64 载荷。
 * - 单张图片本地化失败会记录可观察错误；内联载荷失败时清空 `url` 而不是回填原始
 *   data URL，否则超大 base64 会进入模型上下文并撑爆窗口。
 * - 落盘文件名为 `image_NN.ext`，目录按 `job_id` 划分，重复查询同一任务不会重复落盘。
 */

import path from "node:path";
import { outbound_http_fetch } from "@/http/OutboundHttp.js";
import type { AIActionFilePart, AIActionMessagePart } from "@downcity/federation";
import type {
  ImageResultStorageInput,
  ImageResultStorageResult,
} from "@/city/power/builtin/groups/image/types/Image.js";

/** 可下载的远端图片地址。 */
const HTTP_URL_RE = /^https?:\/\//i;
/** 内联图片载荷，例如 `data:image/png;base64,...`。 */
const DATA_URL_RE = /^data:/i;
/** 单张图片结果允许落盘的最大字节数。 */
const MAX_IMAGE_RESULT_BYTES = 50 * 1024 * 1024;
/** 体积上限的 MiB 展示值，只用于错误文案。 */
const MAX_IMAGE_RESULT_MIB = Math.floor(MAX_IMAGE_RESULT_BYTES / 1024 / 1024);

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  "image/apng": ".apng",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** 当前 capability 的文件端口。 */
type ImageFiles = ImageResultStorageInput["context"];

/** 结果落盘路径解析输入。 */
interface ResultPathInput {
  /** 当前 capability 执行上下文。 */
  context: ImageFiles;
  /** 当前图片任务 ID，用于划分稳定的本地结果目录。 */
  job_id: string;
  /** 结果中第几个 Part（从 0 开始），用于生成稳定文件名。 */
  part_index: number;
  /** 最终采用的 MIME 类型。 */
  media_type: string;
  /** Part 声明的原始文件名。 */
  filename?: string;
  /** 原始地址，仅在缺少 MIME 与文件名时用于推断扩展名。 */
  source_url: string;
}

/** 解析后的内联图片载荷。 */
interface ParsedDataUrl {
  /** data URL 声明的 MIME 类型；未声明时为 `application/octet-stream`。 */
  media_type: string;
  /** 解码后的图片字节。 */
  bytes: Buffer;
}

/** 把外部标识压缩为单个安全路径片段。 */
function to_safe_segment(value: string, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

/** 从 URL 中提取安全的文件扩展名。 */
function extension_from_url(url: string): string {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
  } catch {
    return "";
  }
}

/** 解析落盘文件扩展名。 */
function resolve_extension(input: {
  media_type: string;
  filename?: string;
  source_url: string;
}): string {
  const known = MEDIA_TYPE_EXTENSIONS[input.media_type.toLowerCase()];
  if (known) return known;
  const filename_extension = path.extname(String(input.filename || "")).toLowerCase();
  if (/^\.[a-z0-9]{1,10}$/.test(filename_extension)) return filename_extension;
  return extension_from_url(input.source_url) || ".bin";
}

/** 读取 Part 声明的 MIME 类型。 */
function read_part_media_type(part: AIActionFilePart): string {
  return typeof part.media_type === "string" ? part.media_type.trim() : "";
}

/** 读取 Part 声明的原始文件名。 */
function read_part_filename(part: AIActionFilePart): string | undefined {
  return typeof part.filename === "string" && part.filename.trim() ? part.filename : undefined;
}

/**
 * 把 base64 形式的 data URL 解码为图片字节。
 *
 * 关键点（中文）
 * - 只接受 `;base64` 形式；其它编码属于不确定输入，直接判为失败。
 * - 先按 base64 字符串长度估算体积，避免为超大载荷分配内存后才失败。
 */
function parse_data_url(url: string): ParsedDataUrl {
  const comma_index = url.indexOf(",");
  if (comma_index < 0) throw new Error("image result data URL is missing its payload");
  const meta = url.slice("data:".length, comma_index);
  const payload = url.slice(comma_index + 1);
  const segments = meta.split(";");
  const is_base64 = segments.some((segment) => segment.trim().toLowerCase() === "base64");
  if (!is_base64) throw new Error("image result data URL must be base64 encoded");

  const estimated_bytes = Math.floor((payload.length * 3) / 4);
  if (estimated_bytes > MAX_IMAGE_RESULT_BYTES) {
    throw new Error(`image result exceeds ${MAX_IMAGE_RESULT_MIB} MiB`);
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.byteLength === 0) throw new Error("image result data URL is empty");
  if (bytes.byteLength > MAX_IMAGE_RESULT_BYTES) {
    throw new Error(`image result exceeds ${MAX_IMAGE_RESULT_MIB} MiB`);
  }
  return {
    media_type: (segments[0] || "").trim() || "application/octet-stream",
    bytes,
  };
}

/** 计算图片结果在当前 capability 私有目录中的绝对路径。 */
function resolve_result_path(input: ResultPathInput): string {
  const extension = resolve_extension({
    media_type: input.media_type,
    filename: input.filename,
    source_url: input.source_url,
  });
  const job_segment = to_safe_segment(input.job_id, "job");
  const filename = `image_${String(input.part_index + 1).padStart(2, "0")}${extension}`;
  const relative_path = path.posix.join("image", "results", job_segment, filename);
  return input.context.files.resolve_path(...relative_path.split("/"));
}

/** 把图片字节原子写入指定绝对路径。 */
async function write_image_file(
  context: ImageFiles,
  absolute_path: string,
  bytes: Buffer,
): Promise<void> {
  await context.files.ensure_directory(path.dirname(absolute_path));
  await context.files.write_file_atomically(absolute_path, bytes);
}

/** 读取响应体，并强制上限，避免异常大文件占满磁盘。 */
async function read_response_bytes(response: Response): Promise<Buffer> {
  const declared_length = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared_length) && declared_length > MAX_IMAGE_RESULT_BYTES) {
    throw new Error(`image result exceeds ${MAX_IMAGE_RESULT_MIB} MiB`);
  }
  const body = response.body;
  if (!body) return Buffer.from(await response.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total_bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total_bytes += chunk.value.byteLength;
    if (total_bytes > MAX_IMAGE_RESULT_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`image result exceeds ${MAX_IMAGE_RESULT_MIB} MiB`);
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total_bytes);
}

/** 下载一张远端图片并返回私有目录中的绝对路径。 */
async function persist_remote_image(input: {
  context: ImageFiles;
  job_id: string;
  part: AIActionFilePart;
  source_url: string;
  part_index: number;
}): Promise<string> {
  const response = await outbound_http_fetch(input.source_url, {
    ...(input.context.abort_signal ? { signal: input.context.abort_signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`image download failed with HTTP ${response.status}`);
  }

  const response_media_type = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim();
  const media_type = read_part_media_type(input.part)
    || response_media_type
    || "application/octet-stream";
  const absolute_path = resolve_result_path({
    context: input.context,
    job_id: input.job_id,
    part_index: input.part_index,
    media_type,
    filename: read_part_filename(input.part),
    source_url: input.source_url,
  });
  if (await input.context.files.path_exists(absolute_path)) {
    await response.body?.cancel();
    return absolute_path;
  }
  await write_image_file(input.context, absolute_path, await read_response_bytes(response));
  return absolute_path;
}

/** 解码内联 data URL 并返回私有目录中的绝对路径。 */
async function persist_inline_image(input: {
  context: ImageFiles;
  job_id: string;
  part: AIActionFilePart;
  source_url: string;
  part_index: number;
}): Promise<string> {
  const parsed = parse_data_url(input.source_url);
  const absolute_path = resolve_result_path({
    context: input.context,
    job_id: input.job_id,
    part_index: input.part_index,
    media_type: read_part_media_type(input.part) || parsed.media_type,
    filename: read_part_filename(input.part),
    // 扩展名推断不能依赖 data URL 本身，因此只用已解析出的 MIME 类型。
    source_url: "",
  });
  if (await input.context.files.path_exists(absolute_path)) return absolute_path;
  await write_image_file(input.context, absolute_path, parsed.bytes);
  return absolute_path;
}

/**
 * 把图片结果中的远端与内联 File Parts 本地化。
 *
 * 关键点（中文）
 * - 只有可识别来源的 File Part 会被替换成本地路径，其它 Part 原样保留。
 * - 远端下载失败时保留原有 URL；内联载荷失败时清空 `url`，绝不回填 base64。
 */
export async function localize_image_result(
  input: ImageResultStorageInput,
): Promise<ImageResultStorageResult> {
  const errors: string[] = [];
  const parts: AIActionMessagePart[] = await Promise.all(
    input.result.parts.map(async (part, part_index): Promise<AIActionMessagePart> => {
      if (part.type !== "file") return part;
      const source_url = part.url.trim();
      const is_inline = DATA_URL_RE.test(source_url);
      if (!is_inline && !HTTP_URL_RE.test(source_url)) return part;

      try {
        const local_url = is_inline
          ? await persist_inline_image({
              context: input.context,
              job_id: input.job_id,
              part,
              source_url,
              part_index,
            })
          : await persist_remote_image({
              context: input.context,
              job_id: input.job_id,
              part,
              source_url,
              part_index,
            });
        return {
          ...part,
          url: local_url,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`part ${part_index + 1}: ${message}`);
        return is_inline ? { ...part, url: "" } : part;
      }
    }),
  );

  return {
    result: {
      ...input.result,
      parts,
    },
    errors,
  };
}
