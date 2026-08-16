/**
 * ImagePlugin 生成结果本地化。
 *
 * 关键点（中文）
 * - City / provider 返回的远程图片先落到当前 AgentWorkspace 私有目录，再交给 Agent Session。
 * - File Part 的 `url` 使用稳定的本地绝对路径，原始在线地址写入 provider metadata。
 * - 单张图片下载失败时保留远程地址，并返回可观察错误，不丢弃已经生成成功的结果。
 */

import path from "node:path";
import type {
  ImagePluginResultStorageInput,
  ImagePluginResultStorageResult,
} from "@/image/types/ImagePlugin.js";

const HTTP_URL_RE = /^https?:\/\//i;
const MAX_IMAGE_RESULT_BYTES = 50 * 1024 * 1024;

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  "image/apng": ".apng",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** 判断未知值是否为普通对象。 */
function to_record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

/** 给 File Part 合并 Downcity 来源元数据。 */
function with_source_metadata(
  part: Record<string, unknown>,
  source_url: string,
  localization_error?: string,
): Record<string, unknown> {
  const provider_metadata = to_record(part.providerMetadata) ?? {};
  const downcity_metadata = to_record(provider_metadata.downcity) ?? {};
  return {
    ...part,
    providerMetadata: {
      ...provider_metadata,
      downcity: {
        ...downcity_metadata,
        source_url,
        ...(localization_error ? { localization_error } : {}),
      },
    },
  };
}

/** 受大小上限保护地读取远程响应。 */
async function read_response_bytes(response: Response): Promise<Buffer> {
  const declared_length = Number(response.headers.get("content-length") || 0);
  if (declared_length > MAX_IMAGE_RESULT_BYTES) {
    throw new Error(`image result exceeds ${MAX_IMAGE_RESULT_BYTES} bytes`);
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total_bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total_bytes += chunk.value.byteLength;
    if (total_bytes > MAX_IMAGE_RESULT_BYTES) {
      await reader.cancel();
      throw new Error(`image result exceeds ${MAX_IMAGE_RESULT_BYTES} bytes`);
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total_bytes);
}

/** 下载一张远程图片并返回 AgentWorkspace 私有目录中的绝对路径。 */
async function persist_remote_image(input: {
  context: ImagePluginResultStorageInput["context"];
  job_id: string;
  part: Record<string, unknown>;
  source_url: string;
  part_index: number;
  abort_signal?: AbortSignal;
}): Promise<string> {
  const response = await fetch(input.source_url, {
    signal: input.abort_signal,
  });
  if (!response.ok) {
    throw new Error(`image download failed with HTTP ${response.status}`);
  }

  const declared_media_type = String(input.part.mediaType || "").trim();
  const response_media_type = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim();
  const media_type = declared_media_type || response_media_type || "application/octet-stream";
  const extension = resolve_extension({
    media_type,
    filename: typeof input.part.filename === "string" ? input.part.filename : undefined,
    source_url: input.source_url,
  });
  const job_segment = to_safe_segment(input.job_id, "job");
  const filename = `image_${String(input.part_index + 1).padStart(2, "0")}${extension}`;
  const relative_path = path.posix.join(
    "image",
    "results",
    job_segment,
    filename,
  );
  const absolute_path = input.context.data_files.resolve_path(...relative_path.split("/"));
  if (!(await input.context.data_files.path_exists(absolute_path))) {
    const bytes = await read_response_bytes(response);
    await input.context.data_files.ensure_directory(path.dirname(absolute_path));
    await input.context.data_files.write_file_atomically(absolute_path, bytes);
  } else {
    await response.body?.cancel();
  }
  return absolute_path;
}

/**
 * 把图片结果中的远程 File Parts 本地化，并保留原始在线地址。
 */
export async function localize_image_result(
  input: ImagePluginResultStorageInput,
): Promise<ImagePluginResultStorageResult> {
  const errors: string[] = [];
  const parts = await Promise.all(input.result.parts.map(async (part, part_index) => {
    const record = to_record(part);
    if (record?.type !== "file") return part;
    const source_url = String(record.url || "").trim();
    if (!HTTP_URL_RE.test(source_url)) return part;

    try {
      const local_url = await persist_remote_image({
        context: input.context,
        job_id: input.job_id,
        part: record,
        source_url,
        part_index,
        abort_signal: input.abort_signal,
      });
      return {
        ...with_source_metadata(record, source_url),
        url: local_url,
      } as typeof part;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`part ${part_index + 1}: ${message}`);
      return with_source_metadata(record, source_url, message) as typeof part;
    }
  }));

  return {
    result: {
      ...input.result,
      parts,
    },
    errors,
  };
}
