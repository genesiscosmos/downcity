/**
 * Federation user_token 签发与本地验签模块。
 *
 * 使用 Ed25519 Compact JWT：Federation Key Ring 私钥只负责签发，公开 JWK 只负责验签。
 * token 保留 `ub_` 前缀用于快速识别 Downcity 用户凭证。
 */

import {
  SignJWT,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { httpError, randomSecret } from "../../utils/helpers.js";
import {
  is_bureau_id,
  require_bureau_id,
} from "../identity/bureau-id.js";
import { FederationKeyStore, USER_TOKEN_ALGORITHM } from "./federation-key-store.js";
import type { CreateUserTokenInput, UserTokenPayload } from "./types.js";
import type {
  CreateFederationServiceTokenInput,
  FederationServiceTokenIssueResult,
} from "./types.js";
import { USER_TOKEN_AUDIENCE } from "./audience.js";

const DEFAULT_USER_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_USER_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Federation 内部 user_token 权威。 */
export class UserTokenAuthority {
  constructor(
    private readonly key_store: FederationKeyStore,
    private readonly issuer: string,
  ) {}

  /** 使用当前 active 私钥签发 user_token。 */
  async sign(input: CreateUserTokenInput): Promise<string> {
    validate_sign_input(input);
    const ttl_seconds = parse_user_token_ttl(input.ttl);
    const now = Math.floor(Date.now() / 1000);
    const signing_key = await this.key_store.ensure_active_key();
    const private_jwk = JSON.parse(signing_key.private_jwk) as Record<string, unknown>;
    const private_key = await importJWK(private_jwk, USER_TOKEN_ALGORITHM);

    const jwt = await new SignJWT({
      user_id: input.user_id,
      bureau_id: input.bureau_id,
      metadata: input.metadata ?? {},
    })
      .setProtectedHeader({
        alg: USER_TOKEN_ALGORITHM,
        typ: "JWT",
        kid: signing_key.key_id,
      })
      .setIssuer(this.issuer)
      .setAudience(USER_TOKEN_AUDIENCE)
      .setSubject(input.user_id)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl_seconds)
      .setJti(`token_${randomSecret(16)}`)
      .sign(private_key);

    return `ub_${jwt}`;
  }

  /** 使用 Federation Key Ring 在服务端本地验证 user_token。 */
  async verify(token: string): Promise<UserTokenPayload> {
    const jwt = normalize_user_token(token);
    let key_id = "";
    try {
      const header = decodeProtectedHeader(jwt);
      if (header.alg !== USER_TOKEN_ALGORITHM) {
        throw httpError(401, "Invalid user token algorithm");
      }
      key_id = typeof header.kid === "string" ? header.kid : "";
      if (!key_id) throw httpError(401, "Unknown token signing key");

      const key_record = await this.key_store.get_verification_key(key_id);
      if (!key_record) throw httpError(401, "Unknown token signing key");
      const public_jwk = JSON.parse(key_record.public_jwk) as Record<string, unknown>;
      const public_key = await importJWK(public_jwk, USER_TOKEN_ALGORITHM);
      const result = await jwtVerify(jwt, public_key, {
        algorithms: [USER_TOKEN_ALGORITHM],
        audience: USER_TOKEN_AUDIENCE,
        issuer: this.issuer,
      });
      return read_user_token_payload(result.payload);
    } catch (error) {
      if (is_http_error(error)) throw error;
      throw map_jose_error(error, key_id);
    }
  }

  /** 为可信 Federation Service 签发受众绑定的业务 Token。 */
  async sign_service_token(
    input: CreateFederationServiceTokenInput,
  ): Promise<FederationServiceTokenIssueResult> {
    const audience = read_nonempty_input(input.audience, "audience");
    const subject = read_nonempty_input(input.subject, "subject");
    const prefix = read_token_prefix(input.prefix);
    const ttl_seconds = parse_user_token_ttl(input.ttl);
    validate_service_claims(input.claims);

    const now = Math.floor(Date.now() / 1000);
    const token_id = `token_${randomSecret(16)}`;
    const signing_key = await this.key_store.ensure_active_key();
    const private_jwk = JSON.parse(signing_key.private_jwk) as Record<string, unknown>;
    const private_key = await importJWK(private_jwk, USER_TOKEN_ALGORITHM);
    const jwt = await new SignJWT({ ...input.claims })
      .setProtectedHeader({
        alg: USER_TOKEN_ALGORITHM,
        typ: "JWT",
        kid: signing_key.key_id,
      })
      .setIssuer(this.issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl_seconds)
      .setJti(token_id)
      .sign(private_key);

    return {
      token: `${prefix}${jwt}`,
      token_id,
      expires_at: new Date((now + ttl_seconds) * 1000).toISOString(),
    };
  }
}

/** 将 token TTL 统一解析为秒并限制最大有效期。 */
export function parse_user_token_ttl(ttl?: string | number): number {
  if (ttl === undefined) return DEFAULT_USER_TOKEN_TTL_SECONDS;

  let seconds: number;
  if (typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0) {
    seconds = ttl;
  } else if (typeof ttl === "string") {
    const match = ttl.match(/^(\d+)(s|m|h|d)$/);
    if (!match) throw new TypeError(`Invalid ttl: ${ttl}`);
    const value = Number(match[1]);
    const multiplier = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    }[match[2] as "s" | "m" | "h" | "d"];
    seconds = value * multiplier;
  } else {
    throw new TypeError("ttl must be a positive number of seconds or a string like 1h");
  }

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new TypeError("ttl must resolve to a positive integer number of seconds");
  }
  if (seconds > MAX_USER_TOKEN_TTL_SECONDS) {
    throw new TypeError("ttl cannot exceed 30d");
  }
  return seconds;
}

/** 去掉 Downcity token 前缀并拒绝空 token。 */
export function normalize_user_token(token: string): string {
  const value = String(token ?? "").trim();
  const jwt = value.startsWith("ub_") ? value.slice(3) : value;
  if (!jwt) throw httpError(401, "Invalid user token");
  return jwt;
}

/** 从已通过 JOSE 校验的 payload 构造公共 user token 载荷。 */
export function read_user_token_payload(payload: JWTPayload): UserTokenPayload {
  const user_id = read_required_claim(payload.user_id ?? payload.sub, "user_id");
  const subject = read_required_claim(payload.sub, "sub");
  if (!is_bureau_id(payload.bureau_id)) {
    throw httpError(401, "Invalid user token bureau_id");
  }
  const bureau_id = payload.bureau_id;
  const issuer = read_required_claim(payload.iss, "iss");
  const token_id = read_required_claim(payload.jti, "jti");
  if (user_id !== subject) throw httpError(401, "Invalid user token subject");
  if (payload.aud !== USER_TOKEN_AUDIENCE) {
    throw httpError(401, "Invalid user token audience");
  }
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
    throw httpError(401, "Invalid user token timestamps");
  }
  const metadata = payload.metadata;
  if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
    throw httpError(401, "Invalid user token metadata");
  }
  return {
    aud: USER_TOKEN_AUDIENCE,
    iss: issuer,
    bureau_id,
    user_id,
    sub: subject,
    metadata: (metadata as Record<string, unknown> | undefined) ?? {},
    iat: payload.iat,
    exp: payload.exp,
    jti: token_id,
  };
}

function validate_sign_input(input: CreateUserTokenInput): void {
  require_bureau_id(input?.bureau_id);
  if (typeof input.user_id !== "string" || !input.user_id.trim()) {
    throw new TypeError("user_id is required");
  }
}

/** 读取签发输入中的必填文本。 */
function read_nonempty_input(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

/** 校验业务 Token 前缀，避免生成不可辨识的凭证。 */
function read_token_prefix(value: unknown): string {
  const prefix = read_nonempty_input(value, "prefix");
  if (!/^[a-z][a-z0-9]*_$/u.test(prefix)) {
    throw new TypeError("prefix must match /^[a-z][a-z0-9]*_$/");
  }
  return prefix;
}

/** 禁止 Service 覆盖由 Federation 统一拥有的 JWT 标准 Claims。 */
function validate_service_claims(claims: Record<string, unknown>): void {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new TypeError("claims must be an object");
  }
  const reserved_claims = ["iss", "aud", "sub", "iat", "exp", "jti", "nbf"];
  for (const claim of reserved_claims) {
    if (claim in claims) throw new TypeError(`claims.${claim} is reserved`);
  }
}

function read_required_claim(value: unknown, claim: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(401, `Invalid user token ${claim}`);
  }
  return value.trim();
}

function is_http_error(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error
    && typeof (error as { statusCode?: unknown }).statusCode === "number";
}

function map_jose_error(error: unknown, key_id: string): Error {
  const code = error && typeof error === "object"
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code === "ERR_JWT_EXPIRED") return httpError(401, "User token expired");
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    return httpError(401, "Invalid user token claims");
  }
  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
    return httpError(401, "Invalid user token signature");
  }
  return httpError(401, key_id ? "Invalid user token" : "Unknown token signing key");
}
