/**
 * Service / Action 调用器。
 *
 * city.service("ai").action("text").invoke({ prompt: "hello" })
 *   → POST /v1/ai/text
 *
 * 用户身份与 Bureau 身份只来自请求凭证，不向业务输入重复注入。
 * GET Action 支持通过第二个参数传 query。
 */

import type { RequestInitLike } from "../http.js";

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
  ) {}

  /** 获取 Action 调用器 */
  action(name: string): ActionClient {
    const id = normalizeName(name);
    const url = `${this.prefix}/${encodeURIComponent(this.serviceId)}/${id}`;
    return new ActionClient(this.req, url);
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
