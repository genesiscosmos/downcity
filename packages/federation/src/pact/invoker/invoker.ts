/**
 * Service / Action 调用器。
 *
 * city.service("translate").action("zh2en").invoke({ text: "你好" })
 *   → POST /v1/translate/zh2en
 *
 * 用户身份只来自请求凭证，不向业务输入重复注入。
 * GET Action 支持通过第二个参数传 query。
 */

import type { RequestInitLike, FetchResponseLike } from "../http.js";
import type { ServiceRequestOptions } from "../../types/ServiceRequest.js";

type Requester = <T>(path: string, init: RequestInitLike) => Promise<T>;

/**
 * Action 调用器。
 */
export class ActionClient {
  constructor(
    private readonly req: Requester,
    private readonly url: string,
  ) {}

  /** POST 执行 Action */
  invoke<T = unknown>(input: Record<string, unknown> = {}): Promise<T> {
    return this.req<T>(this.url, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
}

/**
 * Service 调用器。
 */
export class ServiceClient {
  constructor(
    private readonly req: Requester,
    private readonly prefix: string,
    private readonly serviceId: string,
    private readonly request_raw: (path: string, init: RequestInitLike) => Promise<FetchResponseLike>,
  ) {}

  /** 获取 Action 调用器 */
  action(name: string): ActionClient {
    const id = normalizeName(name);
    const url = `${this.prefix}/${encodeURIComponent(this.serviceId)}/${id}`;
    return new ActionClient(this.req, url);
  }

  /** 调用已知方法的 action 并返回原始响应；调用者负责消费或取消正文。 */
  request(name: string, options: ServiceRequestOptions = {}): Promise<FetchResponseLike> {
    const action_path = normalizeName(name).split("/").map((part) => {
      if (!part || part === "." || part === "..") throw new TypeError("Invalid action path");
      return encodeURIComponent(part);
    }).join("/");
    const method = options.method ?? "POST";
    const url = withQuery(`${this.prefix}/${encodeURIComponent(this.serviceId)}/${action_path}`, method === "GET" ? options.query : undefined);
    return this.request_raw(url, {
      method, headers: options.headers, signal: options.signal,
      ...(method === "POST" ? { body: options.body } : {}),
    });
  }

  /** GET 调用 Action（用于 method="GET" 的 action） */
  get<T = unknown>(name: string, query?: Record<string, unknown>): Promise<T> {
    const id = normalizeName(name);
    const url = withQuery(`${this.prefix}/${encodeURIComponent(this.serviceId)}/${id}`, query);
    return this.req<T>(url, { method: "GET" });
  }
}

function normalizeName(value: string): string {
  const s = String(value ?? "").trim().replace(/^\/+/, "");
  if (!s) throw new TypeError("name is required");
  return s;
}

/**
 * 为 GET action 构造 query string。
 *
 * 关键说明（中文）
 * - 统一由 SDK 负责 query 拼接，业务侧不再手写 `foo?bar=baz`
 * - `undefined` / `null` 会被忽略，避免产生无意义参数
 */
function withQuery(url: string, query?: Record<string, unknown>): string {
  if (!query) return url;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }

  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}
