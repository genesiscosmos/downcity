/**
 * Client 包 HTTP 基础设施。
 *
 * 集中处理 fetch 封装、URL 规范化、服务路径等共享工具。
 * 同时包含 HTTP 层的公共类型。
 */

import { read_model_error } from "@downcity/type";
import { read_bounded_error_text } from "../shared/BoundedResponseText.js";

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
  const response = await fetch_with_diagnostics(params);
  if (!response.ok) throw await httpError(response);
  return response.json() as Promise<T>;
}

/** 发送请求并返回原始响应 */
export async function requestRaw(params: {
  fetch: FetchLike;
  url: string;
  init: RequestInitLike;
}): Promise<FetchResponseLike> {
  const response = await fetch_with_diagnostics(params);
  if (!response.ok) throw await httpError(response);
  return response;
}

/** 发送请求并解析文本响应 */
export async function requestText(params: {
  fetch: FetchLike;
  url: string;
  init: RequestInitLike;
}): Promise<string> {
  const response = await fetch_with_diagnostics(params);
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
  const body = await read_bounded_error_text(response.body);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { /* 未识别 HTTP 错误保留状态，不能猜测上下文超限。 */ }
  const record = parsed && typeof parsed === "object" && "error" in parsed ? parsed.error : undefined;
  const model_error = read_model_error(record);
  if (model_error) return Object.assign(new Error(model_error.message), { ...model_error, model_error, status: response.status });
  // 未分类正文也不跨客户端边界返回，避免供应商或代理错误带出敏感内容。
  return Object.assign(new Error(`Downcity request failed with ${response.status}`), { status: response.status });
}

/** 单次发送请求并补充诊断；业务写入和模型调用不透明重试。 */
async function fetch_with_diagnostics(params: {
  /** 当前传输实现，本地和远端共用调用协议。 */
  fetch: FetchLike;
  /** 当前调用的目标地址。 */
  url: string;
  /** 已确定身份的请求快照。 */
  init: RequestInitLike;
}): Promise<FetchResponseLike> {
  try { return await params.fetch(params.url, params.init); }
  catch (error) { throw enrich_fetch_error(error, params); }
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
