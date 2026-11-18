/** 可私下分享的 City 连接信息；权限与有效期始终由 City 凭据存储校验。 */
export interface CityConnection {
  /** 接收者可访问的 City HTTP/HTTPS 根地址，可包含反向代理路径，不含 URL 凭据、查询或片段。 */
  readonly url: string;
  /** 本次分享独立签发的 Bearer 凭据；属于私密值，不应记录、持久化到浏览器或放入链接。 */
  readonly token: string;
}
