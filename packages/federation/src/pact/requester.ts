/**
 * City Pact 请求抽象。
 *
 * 关键点（中文）
 * - 上层 Admin/User invoker 只依赖 requester，不直接操作 fetch。
 * - Federation 统一使用 HTTP(S) 入口；本机服务也应暴露 loopback HTTP URL。
 */

import {
  defaultFetch,
  normalizeBaseURL,
  requestJSON,
  requestRaw,
  requestText,
  type FetchLike,
  type FetchResponseLike,
  type RequestInitLike,
} from "./http.js";

/**
 * City 请求器。
 */
export interface CityRequester {
  /** 请求入口根地址。 */
  readonly base_url: string;
  /** 请求 JSON 并解析。 */
  json<T>(path: string, init: RequestInitLike): Promise<T>;
  /** 请求文本。 */
  text(path: string, init: RequestInitLike): Promise<string>;
  /** 请求原始响应。 */
  raw(path: string, init: RequestInitLike): Promise<FetchResponseLike>;
}

/**
 * 创建 HTTP 请求器。
 */
export function create_http_requester(options: {
  /** Federation HTTP 入口地址。 */
  base_url: string;
  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
  /** 请求头增强函数。 */
  with_auth(init: RequestInitLike): RequestInitLike;
}): CityRequester {
  const base_url = normalize_http_base_url(options.base_url);
  const fetch_impl = options.fetch ?? defaultFetch();
  return {
    base_url,
    json: (path, init) => requestJSON({
      fetch: fetch_impl,
      url: `${base_url}${path}`,
      init: options.with_auth(init),
    }),
    text: (path, init) => requestText({
      fetch: fetch_impl,
      url: `${base_url}${path}`,
      init: options.with_auth(init),
    }),
    raw: (path, init) => requestRaw({
      fetch: fetch_impl,
      url: `${base_url}${path}`,
      init: options.with_auth(init),
    }),
  };
}

/**
 * 判断 Federation URL 是否为 HTTP(S)。
 */
function normalize_http_base_url(value: unknown): string {
  const base_url = normalizeBaseURL(value, "base_url");
  let parsed: URL;
  try {
    parsed = new URL(base_url);
  } catch {
    throw new TypeError("base_url must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Federation URL must use http:// or https://");
  }
  return base_url;
}
