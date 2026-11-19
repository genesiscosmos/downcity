/** 网页端点策略：预览与连接共用校验，HTTPS 页面只对精确本机 HTTP 地址放行。 */
import type { Remote_endpoint } from "../types/endpoint";

/** 只分类用户确认的地址，不解析 DNS、不改写 localhost，也不发起网络请求。 */
export function inspect_city_endpoint(value: string, page_protocol = window.location.protocol): Remote_endpoint {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash
    || url.hostname.includes("*") || url.hostname === "0.0.0.0" || url.hostname === "[::]") {
    throw new Error("The connection code must contain a valid City HTTP/HTTPS address.");
  }
  const local_http = url.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  return {
    url: url.toString().replace(/\/+$/, ""),
    local_http,
    requires_https: page_protocol === "https:" && url.protocol === "http:" && !local_http,
  };
}

/** 实际请求前使用相同策略；浏览器本地网络权限、CORS 与 City 授权仍在后续分别生效。 */
export function normalize_city_url(value: string): string {
  const endpoint = inspect_city_endpoint(value);
  if (endpoint.requires_https) throw new Error("Use HTTPS for a City on another device. HTTP is supported only for a City on this device.");
  return endpoint.url;
}
