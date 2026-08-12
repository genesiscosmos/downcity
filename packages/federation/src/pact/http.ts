/**
 * Client 包 HTTP 基础设施。
 *
 * 集中处理 fetch 封装、URL 规范化、服务路径等共享工具。
 * 同时包含 HTTP 层的公共类型。
 */

// ===========================================================================
// 公共类型
// ===========================================================================

/** fetch 层收到的原始字节流 body */
export type RawStreamBody = ReadableStream<Uint8Array> | null;

/** SDK 内部传给 fetch 的请求配置 */
export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 取消当前请求的标准 AbortSignal。 */
  signal?: AbortSignal;
}

/** fetch 返回对象的最小接口 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  /** 响应头；自定义 fetch 可以省略，不影响非流式调用。 */
  headers?: Pick<Headers, "get" | "forEach">;
  body: RawStreamBody;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** SDK 使用的 fetch 函数签名 */
export interface FetchLike {
  (url: string, init: RequestInitLike): Promise<FetchResponseLike>;
}

// ===========================================================================
// URL 与校验
// ===========================================================================

/** 去掉 server URL 末尾多余斜杠 */
export function normalizeBaseURL(value: unknown, label: string): string {
  const url = requiredString(value, label);
  return url.replace(/\/+$/, "");
}

/** 校验必填字符串 */
export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

// ===========================================================================
// fetch 封装
// ===========================================================================

/** 读取全局 fetch */
export function defaultFetch(): FetchLike {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("fetch is required");
  }
  return async (url, init) => globalThis.fetch(url, init as RequestInit) as Promise<FetchResponseLike>;
}

/** 发送 JSON 请求并解析响应 */
export async function requestJSON<T>(params: {
  fetch: FetchLike;
  url: string;
  init: RequestInitLike;
}): Promise<T> {
  const response = await fetchWithDiagnostics(params);
  if (!response.ok) throw await httpError(response);
  return response.json() as Promise<T>;
}

/** 发送请求并返回原始响应 */
export async function requestRaw(params: {
  fetch: FetchLike;
  url: string;
  init: RequestInitLike;
}): Promise<FetchResponseLike> {
  const response = await fetchWithDiagnostics(params);
  if (!response.ok) throw await httpError(response);
  return response;
}

/** 发送请求并解析文本响应 */
export async function requestText(params: {
  fetch: FetchLike;
  url: string;
  init: RequestInitLike;
}): Promise<string> {
  const response = await fetchWithDiagnostics(params);
  if (!response.ok) throw await httpError(response);
  return response.text();
}

// ===========================================================================
// 服务路径工具
// ===========================================================================

/** 标准化服务 ID */
export function normalizeServiceId(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError("service id is required");
  return normalized;
}

/** 拼接服务请求路径 */
export function servicePath(prefix: string, serviceId: string, path: string): string {
  const suffix = String(path ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return suffix ? `${prefix}/${serviceId}/${suffix}` : `${prefix}/${serviceId}`;
}

// ===========================================================================
// 内部
// ===========================================================================

async function httpError(response: FetchResponseLike): Promise<Error> {
  const body = await response.text();
  const error = new Error(`Downcity request failed with ${response.status}: ${body}`) as Error & {
    status?: number;
    body?: string;
  };
  error.status = response.status;
  error.body = body;
  return error;
}

/**
 * fetch 重试 / 诊断包装。
 *
 * 关键点（中文）
 * - 捕获 transient 错（`TypeError: fetch failed` / undici `UND_ERR_*` / 常见 socket 错）后做指数退避重试。
 * - 重试全部用尽仍失败时，把 `error.cause` 展开成可读字符串再抛出，避免上层只看到 "fetch failed"。
 * - 网络层重试只针对真正的传输错误，HTTP 4xx/5xx 仍然通过 `httpError` 走业务错误链路。
 */
const FETCH_RETRY_DELAYS_MS = [250, 1_000];

async function fetchWithDiagnostics(params: {
  fetch: FetchLike;
  url: string;
  init: RequestInitLike;
}): Promise<FetchResponseLike> {
  const attempts = FETCH_RETRY_DELAYS_MS.length + 1;
  let last_error: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await params.fetch(params.url, params.init);
    } catch (error) {
      last_error = error;
      if (!is_transient_fetch_error(error) || attempt === attempts - 1) {
        throw enrich_fetch_error(error, params);
      }
      const delay_ms = FETCH_RETRY_DELAYS_MS[attempt] ?? 1_000;
      await sleep(delay_ms);
    }
  }
  // 不会真的走到这里，但 TS 需要兜底。
  throw enrich_fetch_error(last_error, params);
}

/**
 * 判定是否属于值得重试的瞬时网络错误。
 */
function is_transient_fetch_error(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = `${error.message} ${describe_error_cause(error)}`;
  return /fetch failed|UND_ERR|ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(
    message,
  );
}

/**
 * 展开 `error.cause` 链，把真正的根因（如 `UND_ERR_SOCKET other side closed`）拼到 message。
 */
function enrich_fetch_error(
  error: unknown,
  params: { url: string; init: RequestInitLike },
): Error {
  if (!(error instanceof Error)) {
    return new Error(
      `Downcity request failed: ${String(error)} :: url=${params.url}`,
    );
  }
  const cause_text = describe_error_cause(error);
  const method = String(params.init.method || "GET").toUpperCase();
  const enriched = new Error(
    `${error.message}${cause_text ? ` :: cause=${cause_text}` : ""} :: ${method} ${params.url}`,
    error.cause ? { cause: error.cause } : undefined,
  );
  enriched.stack = error.stack;
  return enriched;
}

/**
 * 读取 error.cause（含嵌套 cause）里最有价值的诊断字段。
 */
function describe_error_cause(error: Error): string {
  const parts: string[] = [];
  let current: unknown = (error as { cause?: unknown }).cause;
  let depth = 0;
  while (current && depth < 3) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      const code_text = typeof code === "string" ? code : "";
      const message = current.message ? String(current.message) : "";
      parts.push([code_text, message].filter(Boolean).join(" ").trim());
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
    depth += 1;
  }
  return parts.filter(Boolean).join(" -> ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
