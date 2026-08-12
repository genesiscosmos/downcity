/**
 * Bureau 领域公共类型。
 *
 * Bureau 是 Federation 中稳定的产品身份。机器凭证和具体部署都引用
 * Bureau，但不会取代 Bureau 本身的生命周期。
 */

/** Bureau 使用的标准 fetch 能力。 */
export type BureauFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Bureau 生命周期状态。 */
export type BureauState = "active" | "paused" | "archived";

/** Federation 中的稳定 Bureau 身份。 */
export interface BureauRecord extends Record<string, unknown> {
  /** Federation 内全局唯一、创建后不变的 Bureau ID。 */
  bureau_id: string;

  /** 面向管理者展示的产品名称。 */
  name: string;

  /** 当前 Bureau 唯一拥有的服务端部署配置。 */
  server: BureauServerRecord;

  /** Bureau 当前生命周期状态。 */
  state: BureauState;

  /** ISO 8601 创建时间。 */
  created_at: string;

  /** ISO 8601 最后更新时间。 */
  updated_at: string;

  /** ISO 8601 归档时间；未归档时为空字符串。 */
  archived_at: string;
}

/** Bureau 唯一拥有的服务端部署配置。 */
export interface BureauServerRecord extends Record<string, unknown> {
  /** 拥有该 Server 的稳定 Bureau ID，同时也是一对一记录主键。 */
  bureau_id: string;

  /** 当前 Server 的 HTTP(S) 服务入口。 */
  server_url: string;

  /** ISO 8601 创建时间。 */
  created_at: string;

  /** ISO 8601 最后更新时间。 */
  updated_at: string;
}

/** Federation 数据库中不包含部署配置的 Bureau 身份记录。 */
export interface BureauIdentityRecord extends Record<string, unknown> {
  /** Federation 内全局唯一、创建后不变的 Bureau ID。 */
  bureau_id: string;

  /** 面向管理者展示的产品名称。 */
  name: string;

  /** Bureau 当前生命周期状态。 */
  state: BureauState;

  /** ISO 8601 创建时间。 */
  created_at: string;

  /** ISO 8601 最后更新时间。 */
  updated_at: string;

  /** ISO 8601 归档时间；未归档时为空字符串。 */
  archived_at: string;
}

/** 创建 Bureau 时的输入。 */
export interface BureauCreateInput {
  /** 面向管理者展示的产品名称。 */
  name: string;

  /** 当前 Bureau 唯一绑定的服务端 HTTP(S) 入口。 */
  server_url: string;

  /** 自定义 Bureau ID；不要求语义前缀，迁移时应原样保留历史 ID；未传入时由 Federation 生成。 */
  bureau_id?: string;
}

/** 更新 Bureau 服务端入口的输入。 */
export interface BureauServerUpdateInput {
  /** 需要更新的稳定 Bureau ID。 */
  bureau_id: string;

  /** 替换后的服务端 HTTP(S) 入口；不要求跨 Bureau 唯一。 */
  server_url: string;
}

/** Federation 数据库中的 Bureau Token 记录。 */
export interface BureauTokenRecord extends Record<string, unknown> {
  /** Bureau Token 的公开查找 ID。 */
  token_id: string;

  /** Token 所属的稳定 Bureau ID。 */
  bureau_id: string;

  /** Token 对应的部署位置或业务用途。 */
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

/** Federation 管理端签发 Bureau Token 的输入。 */
export interface IssueBureauTokenInput {
  /** Token 所属的稳定 Bureau ID。 */
  bureau_id: string;

  /** Token 对应的部署位置或业务用途。 */
  purpose: string;
}

/** Federation 签发后只返回一次的 Bureau Token。 */
export interface BureauTokenIssueResult extends BureauTokenSummary {
  /** 只在签发响应中出现、应由 Bureau 服务安全持有的完整明文。 */
  bureau_token: string;
}

/** Federation 服务端列出的 Bureau Token 元数据。 */
export interface BureauTokenSummary {
  /** Bureau Token 的公开查找 ID。 */
  token_id: string;

  /** Token 所属的稳定 Bureau ID。 */
  bureau_id: string;

  /** Token 对应的部署位置或业务用途。 */
  purpose: string;

  /** Token 当前状态。 */
  status: "active" | "revoked";

  /** Token 创建时间。 */
  created_at: string;

  /** Token 最后更新时间。 */
  updated_at: string;
}

/** Bureau Token 通过 Federation 鉴权后的机器身份。 */
export interface RuntimeBureauToken {
  /** 当前机器凭证的公开 ID。 */
  token_id: string;
}

/** Federation 根据 Bureau Token 解析出的机器身份。 */
export interface BureauMachineIdentity {
  /** Token 所属的完整 Bureau 注册记录。 */
  bureau: BureauRecord;

  /** 当前机器凭证的公开元数据。 */
  token: RuntimeBureauToken;
}

/** Bureau 构造参数。 */
export interface BureauOptions {
  /** 预先信任的 Federation HTTP 入口地址。 */
  federation_url: string;

  /** 当前 Deployment 在 Federation 注册的机器凭证。 */
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

  /** Token 绑定且已由 Federation 机器身份解析确认的 Bureau ID。 */
  bureau_id: string;

  /** user_token 中携带的可信业务元数据。 */
  metadata: Record<string, unknown>;

  /** user_token 唯一 ID，来源于 JWT jti。 */
  token_id: string;

  /** user_token 过期时间，Unix 秒。 */
  expires_at: number;
}
