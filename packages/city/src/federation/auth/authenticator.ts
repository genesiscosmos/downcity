/**
 * 统一鉴权模块。
 *
 * Authenticator 统一处理管理凭证（root secret 或 Bureau Token）和
 * user_token（Ed25519 JWT）两类鉴权方式。
 * 所有鉴权失败统一抛出 httpError（ErrorWithStatus）。
 */

import { bearerToken, httpError } from "../../utils/helpers.js";
import { normalizeRouteAuth, type RouteAuth, type RouteIdentity } from "../../service/service.js";
import type { EnvProvider } from "../runtime.js";
import { parse_user_token_ttl, type UserTokenAuthority } from "./user-token-authority.js";
import type { FederationKeyStore } from "./federation-key-store.js";
import type { BureauTokenStore } from "./bureau-token-store.js";

import type {
  CreateUserTokenInput,
  FederationDiscovery,
  FederationJwks,
  UserTokenPayload,
  UserTokenIssueResult,
  RuntimeUser,
  CreateFederationServiceTokenInput,
  FederationServiceTokenIssueResult,
} from "./types.js";
import type { FederationTrustedIdentity } from "../types.js";

/** 鉴权级别 */
/** 鉴权结果 */
export interface AuthResult {
  /** 鉴权后的实际级别 */
  level: RouteIdentity;
  /** 解析出的用户信息（user 级别时可用） */
  user?: RuntimeUser;
  /** 解析出的 City 信息（user 级别时可用） */
  city?: { city_id: string; status: string };
}

/** 统一鉴权器 */
export class Authenticator {
  constructor(
    private env: EnvProvider,
    private store: () => Promise<{ city: { get(id: string): Promise<{ city_id: string; status: string } | undefined> } }>,
    private readonly token_authority: UserTokenAuthority,
    private readonly key_store: FederationKeyStore,
    private readonly bureau_token_store: BureauTokenStore,
  ) {}

  /**
   * 解析请求身份。
   *
   * @param request - 原始 HTTP Request
   * @returns 当前请求身份；无 token 或 token 无效时返回 guest
   */
  async resolve(request: Request): Promise<AuthResult> {
    const token = bearerToken(request);
    if (!token) return { level: "guest" };

    const adminKey = this.env.get("DOWNCITY_FEDERATION_ADMIN_SECRET_KEY");
    if (adminKey && token === adminKey) {
      return { level: "admin" };
    }

    if (await this.bureau_token_store.resolve(token)) {
      return { level: "admin" };
    }

    try {
      const payload = await this.token_authority.verify(token);
      const store = await this.store();
      const city = await store.city.get(payload.city_id);
      if (!city) return { level: "guest" };
      if (city.status !== "active") return { level: "guest" };

      return {
        level: "user",
        user: { user_id: payload.user_id, metadata: payload.metadata ?? {} },
        city,
      };
    } catch {
      return { level: "guest" };
    }
  }

  /**
   * 将进程内可信身份转换为统一鉴权结果。
   *
   * 关键点（中文）
   * - 该方法只接受 `Federation.fetch()` options 里的值。
   * - 不读取 HTTP header，避免外部请求伪造本机可信身份。
   */
  resolveTrusted(identity: FederationTrustedIdentity): AuthResult {
    if (identity.level === "admin") {
      return { level: "admin" };
    }
    return {
      level: "user",
      user: identity.user,
      city: identity.city,
    };
  }

  /**
   * 根据 action 的 auth 配置判断当前身份是否允许继续。
   *
   * @param result - 当前已解析身份
   * @param required - action 声明的允许身份集合
   * @returns 通过授权后的身份结果
   */
  authorize(result: AuthResult, required?: RouteAuth): AuthResult {
    const allowed = normalizeRouteAuth(required);
    if (allowed.length === 0) return result;
    if (result.level !== "guest" && allowed.includes(result.level)) return result;

    if (result.level === "guest") {
      throw httpError(401, "Authentication required");
    }

    throw httpError(403, `Forbidden for identity: ${result.level}`);
  }

  /**
   * 对请求执行鉴权并强制满足 action 的 auth 配置。
   */
  async authenticate(request: Request, required?: RouteAuth): Promise<AuthResult> {
    return this.authorize(await this.resolve(request), required);
  }

  /**
   * 签发 user_token（验证 city 状态后签发）。
   *
   * @param input - token 创建参数
   * @returns 签发结果（含 token 字符串）
   */
  async createToken(input: CreateUserTokenInput): Promise<UserTokenIssueResult> {
    const store = await this.store();
    const city = await store.city.get(input.city_id);
    if (!city) throw httpError(404, `Unknown city: ${input.city_id}`);
    if (city.status !== "active") throw httpError(403, `City is not active: ${input.city_id}`);

    const ttl_seconds = parse_user_token_ttl(input.ttl);
    const user_token = await this.token_authority.sign(input);
    return {
      user_token,
      city_id: input.city_id,
      user_id: input.user_id,
      expires_at: new Date(Date.now() + ttl_seconds * 1000).toISOString(),
    };
  }

  /**
   * 校验 user_token 并返回载荷。
   *
   * @param token - user_token 字符串
   * @returns 解析出的 token 载荷
   */
  async verifyToken(token: string): Promise<UserTokenPayload> {
    return this.token_authority.verify(token);
  }

  /** 为可信 Service 签发受众绑定的业务 Token。 */
  create_service_token(
    input: CreateFederationServiceTokenInput,
  ): Promise<FederationServiceTokenIssueResult> {
    return this.token_authority.sign_service_token(input);
  }

  /** 返回 Federation 当前可公开使用的 JWKS。 */
  get_public_jwks(): Promise<FederationJwks> {
    return this.key_store.get_public_jwks();
  }

  /** 根据当前请求 origin 生成 Federation 发现信息。 */
  get_discovery(origin: string): FederationDiscovery {
    const federation_id = this.env.get("DOWNCITY_FEDERATION_ID");
    if (!federation_id) throw new Error("DOWNCITY_FEDERATION_ID is required");
    return {
      issuer: `urn:downcity:federation:${federation_id}`,
      jwks_uri: `${origin.replace(/\/+$/, "")}/.well-known/jwks.json`,
      user_token_audience: "downcity:user",
    };
  }
}
