/**
 * Web Provider 共用的受限 HTTP 客户端。
 *
 * 关键点（中文）
 * - 仅允许公网 HTTP(S)，每次重定向都重新执行 SSRF 检查。
 * - 响应按字节上限流式读取，避免 Content-Length 缺失时无限占用内存。
 * - 错误不包含认证请求头或响应正文。
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** 受限 HTTP 请求参数。 */
export interface SafeFetchOptions {
  /** HTTP 方法。 */
  readonly method?: "GET" | "POST";
  /** 不含敏感日志行为的请求头。 */
  readonly headers?: Readonly<Record<string, string>>;
  /** 可选请求正文。 */
  readonly body?: string;
  /** 超时毫秒数。 */
  readonly timeout_ms?: number;
  /** 最大响应字节数。 */
  readonly max_response_bytes?: number;
  /** 是否允许访问解析到私网地址的官方 API endpoint。 */
  readonly trusted_endpoint?: boolean;
}

/** 完整读取后的安全响应。 */
export interface SafeFetchResult {
  /** 最终响应 URL。 */
  readonly url: string;
  /** HTTP 状态码。 */
  readonly status: number;
  /** 响应 Content-Type。 */
  readonly content_type: string;
  /** UTF-8 响应正文。 */
  readonly text: string;
}

/** 请求公网 URL，并限制跳转、超时和响应大小。 */
export async function safe_fetch(
  input_url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeout_ms = normalize_limit(options.timeout_ms, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
  const max_response_bytes = normalize_limit(
    options.max_response_bytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    1,
    10 * 1024 * 1024,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeout_ms);
  try {
    let url = new URL(input_url);
    for (let redirect_count = 0; redirect_count <= MAX_REDIRECTS; redirect_count += 1) {
      await assert_safe_url(url, options.trusted_endpoint === true && redirect_count === 0);
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        redirect: "manual",
        signal: controller.signal,
      });
      if (is_redirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Web request redirect has no location: ${response.status}`);
        if (redirect_count === MAX_REDIRECTS) throw new Error("Web request exceeded redirect limit");
        url = new URL(location, url);
        continue;
      }
      const text = await read_limited_text(response, max_response_bytes);
      return {
        url: response.url || url.toString(),
        status: response.status,
        content_type: response.headers.get("content-type") ?? "",
        text,
      };
    }
    throw new Error("Web request exceeded redirect limit");
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Web request timed out after ${timeout_ms} ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** 校验 URL 协议、凭据和 DNS 解析结果。 */
async function assert_safe_url(url: URL, trusted_endpoint: boolean): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Web request protocol is not supported: ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("Web request URL credentials are not allowed");
  if (trusted_endpoint) return;
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Web request target is not public");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => is_private_address(address))) {
    throw new Error("Web request target is not public");
  }
}

/** 判断 IP 是否属于本机、私网、链路本地或保留范围。 */
function is_private_address(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.includes(":")) {
    return normalized === "::1"
      || normalized === "::"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/u.test(normalized)
      || normalized.startsWith("::ffff:") && is_private_address(normalized.slice(7));
  }
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168
    || first >= 224;
}

/** 按字节上限读取 Response body。 */
async function read_limited_text(response: Response, max_bytes: number): Promise<string> {
  const declared_length = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared_length) && declared_length > max_bytes) {
    throw new Error(`Web response exceeds ${max_bytes} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total_bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total_bytes += value.byteLength;
    if (total_bytes > max_bytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Web response exceeds ${max_bytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total_bytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** 判断状态码是否为 HTTP redirect。 */
function is_redirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** 把数值约束到安全整数区间。 */
function normalize_limit(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value ?? fallback)));
}
