/** Node HTTP 监听与 Fetch 请求共用的地址格式化，IPv6 在 URL 中使用方括号。 */

/** 将确定的主机与端口组成 HTTP 地址，不读取 Host 或代理请求头。 */
export function format_http_address(host: string, port: number): string {
  const hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${hostname}:${port}`;
}
