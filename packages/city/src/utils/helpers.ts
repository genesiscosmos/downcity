/**
 * 通用工具模块。
 *
 * 提供 HTTP 工具函数、SQL 标识符引用、env key 校验等通用辅助。
 * 所有错误统一抛 ErrorWithStatus，由 router 顶层的 try/catch 转成 JSON Response。
 *
 * 零运行时依赖，使用 Web Crypto API 替代 node:crypto。
 */

// ===========================================================================
// 公共类型
// ===========================================================================

/**
 * 带 HTTP 状态码的错误对象。
 */
export interface ErrorWithStatus extends Error {
  /**
   * 要返回给客户端的 HTTP 状态码。
   */
  statusCode?: number;
  /** 对外稳定错误码；未声明时由 Router 省略。 */
  code?: string;
}

// ===========================================================================
// JSON / Request 工具
// ===========================================================================

/**
 * 从 Request body 中读取 JSON。
 */
export async function readJSON<T extends object>(request: Request): Promise<T> {
  const text = await request.text();
  return parseJSONText<T>(text);
}

/**
 * 从已读取的文本中解析 JSON。
 */
export function parseJSONText<T extends object>(text: string): T {
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

/**
 * 读取 Bearer token。
 */
export function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }
  return authorization.slice("Bearer ".length);
}

/**
 * 生成 JSON Response。
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

/**
 * 创建带 HTTP 状态码的错误。
 */
export function httpError(statusCode: number, message: string): ErrorWithStatus {
  const error = new Error(message) as ErrorWithStatus;
  error.statusCode = statusCode;
  const code = message.match(/^([A-Z][A-Z0-9_]+)(?::|$)/u)?.[1];
  if (code) error.code = code;
  return error;
}

/**
 * 把 unknown 错误统一成 Error。
 */
export function normalizeCaughtError(error: unknown): ErrorWithStatus {
  if (error instanceof Error) {
    return error as ErrorWithStatus;
  }
  return new Error(String(error)) as ErrorWithStatus;
}

// ===========================================================================
// SQL 辅助
// ===========================================================================

/**
 * SQL 标识符引用（双引号转义）。
 *
 * 用于动态拼接 SQL 时安全地引用表名、列名等标识符。
 */
export function quoteIdent(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

// ===========================================================================
// Env 辅助
// ===========================================================================

/**
 * 标准化 env key。
 *
 * 规则：转大写、去首尾空格；只允许 A-Z、0-9、_，且不能以数字开头。
 */
export function normalizeEnvKey(value: unknown): string {
  const key = String(value || "").trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    throw new Error(`invalid env key: ${String(value || "")}`);
  }
  return key;
}

// ===========================================================================
// .env 文本解析
// ===========================================================================

/**
 * 解析 .env 文本格式的环境变量（兼容 export 前缀）。
 *
 * 纯函数，零依赖，可在任何运行时使用。
 *
 * @param raw - .env 文本内容
 * @returns 解析出的键值对数组
 */
export function parseDotenvEntries(raw: unknown): { key: string; value: string }[] {
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) return [];

  const entries: { key: string; value: string }[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // 兼容用户从 shell 里复制 `export KEY=value` 的形式
    const normalized = trimmed.replace(/^export\s+/, "");
    const index = normalized.indexOf("=");
    if (index < 1) continue;

    const key = normalizeEnvKey(normalized.slice(0, index));
    const value = stripDotenvQuotes(normalized.slice(index + 1).trim());
    entries.push({ key, value });
  }

  return entries;
}

/** 去掉 .env 值的引号包裹 */
function stripDotenvQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// ===========================================================================
// 密钥生成
// ===========================================================================

/**
 * 生成加密级随机字符串（base64url 编码）。
 *
 * 使用 Web Crypto API 的 crypto.getRandomValues，
 * 兼容 Node.js、Cloudflare Workers、Deno、Bun、浏览器等所有现代运行时。
 *
 * @param size - 随机字节数，默认 32
 */
export function randomSecret(size = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return base64UrlEncodeBytes(bytes);
}

/**
 * 将 Uint8Array 编码为 base64url 字符串。
 *
 * 与 Buffer.toString("base64url") 行为一致。
 */
export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * 将 base64url 字符串解码为 Uint8Array。
 *
 * 与 Buffer.from(str, "base64url") 行为一致。
 */
export function base64UrlDecodeBytes(str: string): Uint8Array {
  const normalized_base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding_length = (4 - (normalized_base64.length % 4)) % 4;
  const padded_base64 = normalized_base64.padEnd(
    normalized_base64.length + padding_length,
    "=",
  );
  const binary = atob(padded_base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * 将字符串编码为 base64url。
 */
export function base64UrlEncode(data: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(data));
}

/**
 * 将 base64url 字符串解码为 UTF-8 字符串。
 */
export function base64UrlDecode(str: string): string {
  return new TextDecoder().decode(base64UrlDecodeBytes(str));
}

/**
 * 时间安全的字节比较。
 *
 * 替代 node:crypto 的 timingSafeEqual，在所有运行时中行为一致。
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let result = 0;
  for (let i = 0; i < a.byteLength; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
