/**
 * Federation 统一鉴权器。
 *
 * Root Secret、Bureau Token 和 User Token 分别解析为 admin、bureau 和 user，
 * 避免机器凭证隐式获得 Federation 全局管理权限。
 */

import { bearerToken, httpError } from "../../utils/helpers.js";
import { normalizeRouteAuth, type RouteAuth, type RouteIdentity } from "../../service/service.js";
import type { BureauRecord, RuntimeBureauToken } from "../../types/Bureau.js";
import type { EnvProvider } from "../runtime.js";
import { parse_user_token_ttl, type UserTokenAuthority } from "./user-token-authority.js";
import type { FederationKeyStore } from "./federation-key-store.js";
import type { BureauTokenStore } from "./bureau-token-store.js";
import { FEDERATION_USER_TOKEN_AUDIENCE } from "./audience.js";
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

/** Federation 请求的已验证身份。 */
export interface AuthResult {
  /** 鉴权后的实际级别。 */
  level: RouteIdentity;
  /** user 身份对应的 Federation User。 */
  user?: RuntimeUser;
  /** user 或 bureau 身份对应的稳定 Bureau。 */
  bureau?: BureauRecord;
  /** bureau 身份使用的机器凭证元数据。 */
  bureau_token?: RuntimeBureauToken;
}

interface AuthenticatorStore {
  /** 按稳定 ID 读取 Bureau。 */
  bureau: {
    get(bureau_id: string): Promise<BureauRecord | undefined>;
  };
}

/** Federation 统一鉴权器。 */
export class Authenticator {
  constructor(
    private readonly env: EnvProvider,
    private readonly store: () => Promise<AuthenticatorStore>,
    private readonly token_authority: UserTokenAuthority,
    private readonly key_store: FederationKeyStore,
    private readonly bureau_token_store: BureauTokenStore,
  ) {}

  /** 解析 HTTP Bearer 凭证，失败时返回 guest。 */
  async resolve(request: Request): Promise<AuthResult> {
    const token = bearerToken(request);
    if (!token) return { level: "guest" };

    const admin_key = this.env.get("DOWNCITY_FEDERATION_ADMIN_SECRET_KEY");
    if (admin_key && token === admin_key) return { level: "admin" };

    const bureau_token = await this.bureau_token_store.resolve(token);
    if (bureau_token) {
      const bureau = await this.read_active_bureau(bureau_token.bureau_id);
      if (!bureau) return { level: "guest" };
      return {
        level: "bureau",
        bureau,
        bureau_token: { token_id: bureau_token.token_id },
      };
    }

    try {
      const payload = await this.token_authority.verify(token);
      const bureau = await this.read_active_bureau(payload.bureau_id);
      if (!bureau) return { level: "guest" };
      return {
        level: "user",
        user: { user_id: payload.user_id, metadata: payload.metadata ?? {} },
        bureau,
      };
    } catch {
      return { level: "guest" };
    }
  }

  /** 将进程内可信身份转换为统一鉴权结果。 */
  resolveTrusted(identity: FederationTrustedIdentity): AuthResult {
    if (identity.level === "admin") return { level: "admin" };
    if (identity.level === "bureau") {
      return {
        level: "bureau",
        bureau: identity.bureau,
        bureau_token: identity.bureau_token,
      };
    }
    return {
      level: "user",
      user: identity.user,
      bureau: identity.bureau,
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

  /** 验证 Bureau 状态后签发 User Token。 */
  async createToken(input: CreateUserTokenInput): Promise<UserTokenIssueResult> {
    const bureau = await (await this.store()).bureau.get(input.bureau_id);
    if (!bureau) throw httpError(404, `Unknown Bureau: ${input.bureau_id}`);
    if (bureau.state !== "active") {
      throw httpError(403, `Bureau is not active: ${input.bureau_id}`);
    }

    const ttl_seconds = parse_user_token_ttl(input.ttl);
    return {
      user_token: await this.token_authority.sign(input),
      bureau_id: input.bureau_id,
      user_id: input.user_id,
      expires_at: new Date(Date.now() + ttl_seconds * 1000).toISOString(),
    };
  }

  /** 校验 User Token 并返回标准载荷。 */
  verifyToken(token: string): Promise<UserTokenPayload> {
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
      federation_user_token_audience: FEDERATION_USER_TOKEN_AUDIENCE,
      bureau_user_token_audience_prefix: "urn:downcity:bureau:",
    };
  }

  private async read_active_bureau(bureau_id: string): Promise<BureauRecord | undefined> {
    const bureau = await (await this.store()).bureau.get(bureau_id);
    return bureau?.state === "active" ? bureau : undefined;
  }
}
