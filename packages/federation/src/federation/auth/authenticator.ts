/**
 * Federation 统一鉴权器。
 *
 * 管理员 Session 和 User Token 分别解析为 admin 和 user，
 * 管理员与用户业务权限保持隔离。
 */

import type { UserSessionStore } from "./user-session-store.js";
import { bearerToken, httpError } from "../../utils/helpers.js";
import { normalizeRouteAuth, type RouteAuth, type RouteIdentity } from "../../service/service.js";
import type { EnvProvider } from "../runtime.js";
import { parse_user_token_ttl, type UserTokenAuthority } from "./user-token-authority.js";
import type { FederationKeyStore } from "./federation-key-store.js";
import type { FederationAdminStore } from "./admin-store.js";
import type { UserTokenRevocationStore } from "./user-token-revocation-store.js";
import { USER_TOKEN_AUDIENCE } from "./audience.js";
import type {
  CreateUserTokenInput,
  FederationDiscovery,
  FederationJwks,
  UserTokenPayload,
  UserTokenIssueResult,
  RuntimeUser,
} from "./types.js";
import type { FederationTrustedIdentity } from "../types.js";

/** Federation 请求的已验证身份。 */
export interface AuthResult {
  /** 鉴权后的实际级别。 */
  level: RouteIdentity;
  /** user 身份对应的 Federation User。 */
  user?: RuntimeUser;
  /** admin 身份对应的管理员 ID。 */
  admin_id?: string;
  /** admin 身份对应的管理会话 ID。 */
  admin_session_id?: string;
}

/** Federation 统一鉴权器。 */
export class Authenticator {
  constructor(
    private readonly env: EnvProvider,
    private readonly token_authority: UserTokenAuthority,
    private readonly key_store: FederationKeyStore,
    private readonly admin_store: FederationAdminStore,
    private readonly user_token_revocations: UserTokenRevocationStore,
    readonly user_sessions: UserSessionStore,
  ) {}

  /** 解析 HTTP Bearer 凭证，失败时返回 guest。 */
  async resolve(request: Request): Promise<AuthResult> {
    const token = bearerToken(request);
    if (!token) return { level: "guest" };

    const admin_session = await this.admin_store.resolve_session(token);
    if (admin_session) {
      return {
        level: "admin",
        admin_id: admin_session.admin_id,
        admin_session_id: admin_session.session_id,
      };
    }

    try {
      const payload = await this.verifyToken(token);
      return {
        level: "user",
        user: { user_id: payload.user_id, metadata: payload.metadata ?? {} },
      };
    } catch (error) {
      if ((error as { /** 明确的凭证失效状态。 */ statusCode?: number }).statusCode === 401) {
        return { level: "guest" };
      }
      throw httpError(503, "Federation authentication temporarily unavailable");
    }
  }

  /** 将进程内可信身份转换为统一鉴权结果。 */
  resolveTrusted(identity: FederationTrustedIdentity): AuthResult {
    if (identity.level === "admin") return { level: "admin" };
    return {
      level: "user",
      user: identity.user,
    };
  }

  /** 根据 Action 声明校验已解析身份。 */
  authorize(result: AuthResult, required?: RouteAuth): AuthResult {
    const allowed = normalizeRouteAuth(required);
    if (allowed.length === 0) return result;
    if (result.level !== "guest" && allowed.includes(result.level)) return result;
    if (result.level === "guest") throw httpError(401, "Authentication required");
    throw httpError(403, `Forbidden for identity: ${result.level}`);
  }

  /** 解析并校验 HTTP 请求身份。 */
  async authenticate(request: Request, required?: RouteAuth): Promise<AuthResult> {
    return this.authorize(await this.resolve(request), required);
  }

  /** 签发当前 Federation 用户 Token。 */
  async createToken(input: CreateUserTokenInput): Promise<UserTokenIssueResult> {
    const ttl_seconds = parse_user_token_ttl(input.ttl);
    return {
      user_token: await this.token_authority.sign(input),
      user_id: input.user_id,
      expires_at: new Date(Date.now() + ttl_seconds * 1000).toISOString(),
    };
  }

  /** 校验签名、受众、签发者、到期与当前会话撤销；存储不可用时拒绝。 */
  async verifyToken(token: string): Promise<UserTokenPayload> {
    const payload = await this.token_authority.verify(token);
    if (await this.user_token_revocations.is_revoked(payload.jti)) {
      throw httpError(401, "User token revoked");
    }
    const session_id = payload.metadata?.session_id;
    if (typeof session_id === "string") await this.user_sessions.require_active(session_id, payload.user_id);
    return payload;
  }

  /** 验签后幂等撤销当前 Token；不接收未经验证的 jti 或任意用户 ID。 */
  async revoke_user_token(token: string): Promise<void> {
    const payload = await this.token_authority.verify(token);
    if (typeof payload.metadata?.session_id === "string") {
      await this.user_sessions.revoke_access(payload.metadata.session_id, payload.user_id);
    }
    await this.user_token_revocations.revoke(payload);
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
      user_token_audience: USER_TOKEN_AUDIENCE,
    };
  }

}
