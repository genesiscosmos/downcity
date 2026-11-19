/** CLI 持久化的 City HTTP 发布配置；仅包含非凭据设置。 */
export interface CityRemoteConfig {
  /** 客户端可连接的 HTTP/HTTPS 基础地址；空值表示尚未声明公开地址。 */
  public_url: string | null;
  /** 精确的浏览器 HTTP/HTTPS Origins；空数组不允许额外跨域来源。 */
  allowed_origins: string[];
}
