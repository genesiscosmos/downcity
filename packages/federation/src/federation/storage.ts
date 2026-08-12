/**
 * Federation 通用存储能力。
 *
 * 关键点（中文）
 * - Storage 是 Federation 级基础设施，不绑定图片、音频或其它具体业务。
 * - Service 通过 `ctx.storage` 访问默认存储能力，Provider 不需要感知具体云厂商。
 * - 具体实现负责下载源文件、写入后端，并返回可公开访问的 URL。
 */

/** 存储单个外部资源的输入。 */
export interface FederationStorageStoreInput {
  /** 上游资源原始 URL。 */
  source_url: string;
  /** 资源 MIME 类型，例如 `image/png`。 */
  media_type: string;
  /** 建议文件名，存储实现可用于推断扩展名。 */
  filename?: string;
}

/** 存储单个外部资源后的结果。 */
export interface FederationStorageStoreResult {
  /** 自有存储返回的可访问 URL。 */
  url: string;
}

/** Federation 默认存储后端接口。 */
export interface FederationStorage {
  /** 存储后端唯一 ID，例如 `r2`、`oss`。 */
  id: string;
  /**
   * 判断 URL 是否已经归属当前存储。
   *
   * 关键点（中文）
   * - 用于避免已转存资源被二次转存。
   * - 实现方通常按 public URL prefix 判断。
   */
  owns(url: string): boolean;
  /** 把外部资源转存到当前后端并返回公开 URL。 */
  store(input: FederationStorageStoreInput): Promise<FederationStorageStoreResult>;
}

/** R2 bucket 写入所需的最小接口，兼容 Cloudflare Workers R2Bucket。 */
export interface R2BucketLike {
  /** 写入对象内容。 */
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
    },
  ): Promise<unknown>;
}

/** R2Storage 构造配置。 */
export interface R2StorageOptions {
  /** Cloudflare Workers 注入的 R2 bucket binding。 */
  bucket: R2BucketLike;
  /** R2 bucket 的公开访问前缀，例如 `https://images.downcity.dev`。 */
  public_url_prefix: string;
  /** 存储后端 ID，默认 `r2`。 */
  id?: string;
}

const STORAGE_FETCH_RETRY_DELAYS_MS = [250, 1_000];

/**
 * 创建 Cloudflare R2 存储后端。
 */
export function R2Storage(options: R2StorageOptions): FederationStorage {
  const public_url_prefix = normalize_public_url_prefix(options.public_url_prefix);
  return {
    id: options.id ?? "r2",
    owns(url: string): boolean {
      return normalize_url(url).startsWith(`${public_url_prefix}/`);
    },
    async store(input: FederationStorageStoreInput): Promise<FederationStorageStoreResult> {
      const source_url = normalize_url(input.source_url);
      if (!source_url) throw new Error("storage source_url is required");
      const media_type = normalize_media_type(input.media_type);
      const response = await fetch_with_retry(source_url);
      if (!response.ok) {
        throw new Error(`Storage source download failed with ${response.status}: ${source_url}`);
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0) {
        throw new Error(`Storage source download is empty: ${source_url}`);
      }
      const content_type = normalize_media_type(response.headers.get("content-type") ?? media_type);
      const hash = await sha256_hex(bytes);
      const key = `${hash}${resolve_extension({
        filename: input.filename,
        media_type: content_type,
        source_url,
      })}`;
      await options.bucket.put(key, bytes, {
        httpMetadata: {
          contentType: content_type,
        },
      });
      return {
        url: `${public_url_prefix}/${key}`,
      };
    },
  };
}

function normalize_url(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize_public_url_prefix(value: unknown): string {
  const normalized = normalize_url(value).replace(/\/+$/u, "");
  if (!normalized) throw new Error("R2Storage public_url_prefix is required");
  return normalized;
}

function normalize_media_type(value: unknown): string {
  const normalized = String(value || "").split(";")[0]?.trim().toLowerCase() || "";
  return normalized || "application/octet-stream";
}

function resolve_extension(input: {
  filename?: string;
  media_type: string;
  source_url: string;
}): string {
  const from_filename = extension_from_filename(input.filename);
  if (from_filename) return from_filename;
  const from_url = extension_from_filename(filename_from_url(input.source_url));
  if (from_url) return from_url;
  return extension_from_media_type(input.media_type);
}

function extension_from_filename(filename: string | undefined): string {
  const raw = normalize_url(filename);
  const match = /(\.[a-z0-9]{1,12})$/iu.exec(raw);
  return match ? match[1].toLowerCase() : "";
}

function filename_from_url(raw_url: string): string | undefined {
  try {
    const parsed = new URL(raw_url);
    const segments = parsed.pathname.split("/");
    return decodeURIComponent(segments[segments.length - 1] || "") || undefined;
  } catch {
    return undefined;
  }
}

function extension_from_media_type(media_type: string): string {
  if (media_type === "image/png") return ".png";
  if (media_type === "image/jpeg" || media_type === "image/jpg") return ".jpg";
  if (media_type === "image/webp") return ".webp";
  if (media_type === "image/gif") return ".gif";
  if (media_type === "application/pdf") return ".pdf";
  return ".bin";
}

async function fetch_with_retry(url: string): Promise<Response> {
  const attempts = STORAGE_FETCH_RETRY_DELAYS_MS.length + 1;
  let last_error: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      last_error = error;
      if (attempt === attempts - 1) throw enrich_fetch_error(error, url);
      await sleep(STORAGE_FETCH_RETRY_DELAYS_MS[attempt] ?? 1_000);
    }
  }
  throw enrich_fetch_error(last_error, url);
}

function enrich_fetch_error(error: unknown, url: string): Error {
  if (!(error instanceof Error)) {
    return new Error(`Storage source download failed: ${String(error)} :: url=${url}`);
  }
  const cause_text = describe_error_cause(error);
  return new Error(
    `${error.message}${cause_text ? ` :: cause=${cause_text}` : ""} :: url=${url}`,
    error.cause ? { cause: error.cause } : undefined,
  );
}

function describe_error_cause(error: Error): string {
  const parts: string[] = [];
  let current: unknown = (error as { cause?: unknown }).cause;
  let depth = 0;
  while (current && depth < 3) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      const code_text = typeof code === "string" && code ? `${code} ` : "";
      parts.push(`${code_text}${current.message || current.name}`.trim());
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
    depth += 1;
  }
  return parts.filter(Boolean).join(" -> ");
}

async function sha256_hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
