/** City 连接地址的跨平台校验；服务端发布地址与连接码共用，不读取请求或代理头。 */

/** 规范化客户端可连接的 HTTP/HTTPS 地址，拒绝凭据、查询、片段及通配主机。 */
export function normalize_city_connection_url(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Invalid City connection address"); }
  if (url.href.length > 8192 || !/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.hostname.includes("*")) {
    throw new Error("City connection requires an HTTP/HTTPS address without credentials, query or fragment");
  }
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") {
    throw new Error("City connection requires a reachable host, not a wildcard listen address");
  }
  return url.toString().replace(/\/+$/, "");
}
