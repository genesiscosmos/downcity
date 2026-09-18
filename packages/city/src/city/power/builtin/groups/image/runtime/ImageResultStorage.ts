/**
 * Image capability 生成结果本地化。
 *
 * 关键点（中文）
 * - 图片服务返回的远程图片先落到当前 capability 私有目录，再交给 Agent Session。
 * - File Part 的 `url` 使用稳定的本地绝对路径。
 * - 单张图片下载失败时保留远程地址，并返回可观察错误，不丢弃已经生成成功的结果。
 */

import path from "node:path";
import { outbound_http_fetch } from "@/http/OutboundHttp.js";
import type { SessionAgentContent } from "@downcity/agent";
import type {
  ImageResultStorageInput,
  ImageResultStorageResult,
} from "@/city/power/builtin/groups/image/types/Image.js";

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

/** 读取响应体，并强制上限，避免异常大文件占满磁盘。 */
async function read_response_bytes(response: Response): Promise<Buffer> {
  const declared_length = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared_length) && declared_length > MAX_IMAGE_RESULT_BYTES) {
    throw new Error(
      `image result exceeds ${Math.floor(MAX_IMAGE_RESULT_BYTES / 1024 / 1024)} MiB`,
    );
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
      throw new Error(
        `image result exceeds ${Math.floor(MAX_IMAGE_RESULT_BYTES / 1024 / 1024)} MiB`,
      );
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total_bytes);
}

/** 下载一张远程图片并返回当前 capability 私有目录中的绝对路径。 */
async function persist_remote_image(input: {
  context: ImageResultStorageInput["context"];
  job_id: string;
  part: Extract<SessionAgentContent, { type: "file" }>;
  source_url: string;
  part_index: number;
}): Promise<string> {
  const response = await outbound_http_fetch(input.source_url, {
    ...(input.context.abort_signal ? { signal: input.context.abort_signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`image download failed with HTTP ${response.status}`);
  }

  const declared_media_type = input.part.media_type.trim();
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
  const relative_path = path.posix.join("image", "results", job_segment, filename);
  const absolute_path = input.context.files.resolve_path(...relative_path.split("/"));
  if (!(await input.context.files.path_exists(absolute_path))) {
    const bytes = await read_response_bytes(response);
    await input.context.files.ensure_directory(path.dirname(absolute_path));
    await input.context.files.write_file_atomically(absolute_path, bytes);
  } else {
    await response.body?.cancel();
  }
  return absolute_path;
}

/**
 * 把图片结果中的远程 File Parts 本地化，并保留原始在线地址。
 */
export async function localize_image_result(
  input: ImageResultStorageInput,
): Promise<ImageResultStorageResult> {
  const errors: string[] = [];
  const parts: SessionAgentContent[] = await Promise.all(
    input.result.parts.map(async (part, part_index): Promise<SessionAgentContent> => {
      if (part.type !== "file") return part;
      const source_url = part.url.trim();
      if (!HTTP_URL_RE.test(source_url)) return part;

      try {
        const local_url = await persist_remote_image({
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
        return part;
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
