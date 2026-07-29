/**
 * Auth 域公共类型。
 *
 * 包含 token 相关的用户、载荷和签发结果类型。
 */

/**
 * Runtime 中的终端用户信息。
 */
export interface RuntimeUser {
  /**
   * 开发者系统中的用户主键。
   */
  user_id: string;

  /**
   * 附带在 token 中的业务元数据。
   */
  metadata?: Record<string, unknown>;
}

/**
 * 签发 user_token 的输入。
 */
export interface CreateUserTokenInput {
  /**
   * token 所属的 City ID。
   */
  city_id: string;

  /**
   * token 所属的终端用户 ID。
   */
  user_id: string;

  /**
   * 附带进 token 的业务元数据。
   */
  metadata?: Record<string, unknown>;

  /**
   * token 有效期。
   *
   * 支持 `30m`、`1h`、`7d` 或秒数。
   */
  ttl?: string | number;
}

/**
 * user_token 的标准载荷。
 */
export interface UserTokenPayload {
  /**
   * token 受众。
   */
  aud: "downcity:user";

  /**
   * 签发该 token 的 Federation 稳定 issuer。
   */
  iss: string;

  /**
   * token 所属 City ID。
   */
  city_id: string;

  /**
   * token 所属用户 ID。
   */
  user_id: string;

  /**
   * JWT 标准主体字段，与 user_id 保持一致。
   */
  sub: string;

  /**
   * 业务元数据。
   */
  metadata?: Record<string, unknown>;

  /**
   * 签发时间。
   */
  iat: number;

  /**
   * 过期时间。
   */
  exp: number;

  /**
   * token 唯一 ID，用于审计与后续撤销扩展。
   */
  jti: string;
}

/** Federation 签名密钥生命周期状态。 */
export type FederationAuthKeyStatus = "active" | "retired" | "revoked";

/** Federation 数据库中的 Ed25519 签名密钥记录。 */
export interface FederationAuthKeyRecord extends Record<string, unknown> {
  /** JWT protected header 使用的密钥 ID。 */
  key_id: string;

  /** JOSE 签名算法，当前固定为 EdDSA。 */
  algorithm: "EdDSA";

  /** 可公开发布的 Ed25519 Public JWK JSON。 */
  public_jwk: string;

  /** 仅 Federation 签发路径可读的 Ed25519 Private JWK JSON。 */
  private_jwk: string;

  /** 当前密钥生命周期状态。 */
  status: FederationAuthKeyStatus;

  /** 密钥创建时间。 */
  created_at: string;

  /** 密钥停止签发时间；active 状态为空字符串。 */
  retired_at: string;
}

/** Federation 对外发布的 JSON Web Key。 */
export interface FederationPublicJwk extends Record<string, unknown> {
  /** 密钥类型，Ed25519 固定为 OKP。 */
  kty: "OKP";

  /** 椭圆曲线，固定为 Ed25519。 */
  crv: "Ed25519";

  /** JOSE 签名算法。 */
  alg: "EdDSA";

  /** 公钥用途，固定用于签名验证。 */
  use: "sig";

  /** JWT protected header 对应的密钥 ID。 */
  kid: string;

  /** Ed25519 公钥的 Base64URL 编码。 */
  x: string;
}

/** Federation JWKS 响应。 */
export interface FederationJwks {
  /** 当前可用于验签的 active 与 retired 公钥。 */
  keys: FederationPublicJwk[];
}

/** Federation 公共发现信息。 */
export interface FederationDiscovery {
  /** Federation 首次启动后保持稳定的 issuer。 */
  issuer: string;

  /** 当前 Federation 的公开 JWKS 地址。 */
  jwks_uri: string;

  /** user_token 必须包含的 audience。 */
  user_token_audience: "downcity:user";
}

/**
 * City 返回给管理端的发 token 结果。
 */
export interface UserTokenIssueResult {
  /**
   * 可交给 User City 使用的 token。
   */
  user_token: string;

  /**
   * token 所属 City ID。
   */
  city_id: string;

  /**
   * token 所属用户 ID。
   */
  user_id: string;

  /**
   * token 过期时间。
   */
  expires_at: string;
}

/** Federation 为可信 Service 签发受众绑定 Token 的输入。 */
export interface CreateFederationServiceTokenInput {
  /** Token 受众，例如目标 City Server Origin。 */
  audience: string;
  /** Token 主体。 */
  subject: string;
  /** Token 类型前缀，例如 `ot_`。 */
  prefix: string;
  /** Token 有效期，格式与 user_token TTL 一致。 */
  ttl: string | number;
  /** Service 自己拥有的非标准 Claims。 */
  claims: Record<string, unknown>;
}

/** Federation Service Token 签发结果。 */
export interface FederationServiceTokenIssueResult {
  /** 带业务前缀的 Compact JWT。 */
  token: string;
  /** Token 唯一 ID。 */
  token_id: string;
  /** ISO 8601 过期时间。 */
  expires_at: string;
}
