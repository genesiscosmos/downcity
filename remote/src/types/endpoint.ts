/** Remote 网页的连接目标策略；不改变 City SDK 对合法 HTTP/HTTPS 地址的支持。 */
export interface Remote_endpoint {
  /** 校验并去除末尾斜线后的 City 根地址，不含 URL 凭据、查询或片段。 */
  url: string;
  /** HTTP 目标是否精确匹配受支持的本机回环主机；不代表本地服务已启动。 */
  local_http: boolean;
  /** 当前 HTTPS 页面是否应阻止普通 HTTP 目标；本机回环 HTTP 允许交由浏览器判断。 */
  requires_https: boolean;
}
