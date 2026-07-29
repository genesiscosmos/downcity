/**
 * Bureau 公共类型模块。
 *
 * Bureau 是 Federation 下的可信管理与独立服务节点。它使用 Bureau Token
 * 管理 Federation，并使用 Federation 公钥验证独立服务收到的 user_token。
 */

/** Bureau 使用的标准 fetch 能力。 */
export type BureauFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Federation 数据库中的 Bureau Token 记录。 */
export interface BureauTokenRecord extends Record<string, unknown> {
  /** Bureau Token 的公开查找 ID。 */
  token_id: string;

  /** Token 对应的部署位置或业务用途，供管理员识别凭证。 */
  purpose: string;

  /** Bureau Token 完整明文的 SHA-256 Base64URL hash。 */
  token_hash: string;

  /** Token 当前状态。 */
  status: "active" | "revoked";

  /** Token 创建时间。 */
  created_at: string;

  /** Token 最后更新时间。 */
  updated_at: string;
}

/** Federation 管理端登记 Bureau Token 的输入。 */
export interface RegisterBureauTokenInput {
  /** CLI 生成的 Bureau Token 查找 ID。 */
  token_id: string;

  /** Token 对应的部署位置或业务用途。 */
  purpose: string;

  /** CLI 对完整 Bureau Token 计算的 SHA-256 Base64URL hash。 */
  token_hash: string;
}

/** Federation 服务端列出的 Bureau Token 元数据。 */
export interface BureauTokenSummary {
  /** Bureau Token 的公开查找 ID。 */
  token_id: string;

  /** Token 对应的部署位置或业务用途。 */
  purpose: string;

  /** Token 当前状态。 */
  status: "active" | "revoked";

  /** Token 创建时间。 */
  created_at: string;

  /** Token 最后更新时间。 */
  updated_at: string;
}

/** Bureau 构造参数。 */
export interface BureauOptions {
  /** 预先信任的 Federation HTTP 入口地址。 */
  federation_url: string;

  /** Federation 注册表中的管理凭证。 */
  bureau_token: string;

  /** 自定义 fetch 实现。 */
  fetch?: BureauFetch;

  /** Federation discovery 与 JWKS 的本地缓存时间，单位毫秒。 */
  jwks_cache_ttl?: number;
}

/** Bureau 本地验签后得到的 Federation 用户身份。 */
export interface BureauIdentity {
  /** Federation 用户 ID，来源于已验证 JWT。 */
  user_id: string;

  /** user_token 所属的 City ID，供 Bureau 独立服务执行授权策略。 */
  city_id: string;

  /** user_token 中携带的可信业务元数据。 */
  metadata: Record<string, unknown>;

  /** user_token 唯一 ID，来源于 JWT jti。 */
  token_id: string;

  /** user_token 过期时间，Unix 秒。 */
  expires_at: number;
}
