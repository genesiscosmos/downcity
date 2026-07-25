/**
 * 统一账户服务层。
 *
 * 关键点（中文）
 * - 该模块承接本机 token 初始化、token 校验与 token 管理等业务语义。
 * - 路由层只调用这里，不直接碰数据库与密码哈希细节。
 */

import type { AuthIssuedToken, AuthTokenSummary } from "@downcity/type";
import type { AuthPrincipal, AuthTokenRecord, AuthUser } from "@downcity/type";
import { AuthError } from "@/city/runtime/auth/AuthError.js";
import { AuthStore, type AuthStoreOptions } from "@/city/runtime/auth/AuthStore.js";
import { extractBearerToken, generateAccessToken, hashAccessToken } from "@/city/runtime/auth/TokenService.js";
import { optionalTrimmedText } from "@/city/runtime/store/StoreShared.js";

const LOCAL_CLI_USERNAME = "local-cli";
const LOCAL_CLI_DISPLAY_NAME = "Local CLI";
const LOCAL_CLI_PASSWORD_HASH = "[token-only-local-cli]";

/**
 * AuthService 构造参数。
 */
export interface AuthServiceOptions extends AuthStoreOptions {
  /**
   * 复用外部传入的 store。
   */
  store?: AuthStore;
}

/**
 * 登录/初始化后返回的用户摘要。
 */
export interface AuthCurrentUserPayload {
  /**
   * 用户 ID。
   */
  id: string;
  /**
   * 用户名。
   */
  username: string;
  /**
   * 展示名。
   */
  display_name?: string;
  /**
   * 角色列表。
   */
  roles: string[];
  /**
   * 权限列表。
   */
  permissions: string[];
}

/**
 * AuthService 门面。
 */
export class AuthService {
  private readonly store: AuthStore;
  private readonly ownsStore: boolean;

  constructor(options: AuthServiceOptions = {}) {
    if (options.store) {
      this.store = options.store;
      this.ownsStore = false;
      return;
    }
    this.store = new AuthStore(options);
    this.ownsStore = true;
  }

  /**
   * 关闭底层连接。
   */
  close(): void {
    if (this.ownsStore) this.store.close();
  }

  /**
   * 判断当前是否已经存在可用的本机 CLI access token。
   */
  hasLocalCliAccess(): boolean {
    const user = this.store.findUserByUsername(LOCAL_CLI_USERNAME);
    if (!user) return false;
    return this.store
      .listTokensByUserId(user.id)
      .some((item) => this.isTokenActive(item));
  }

  /**
   * 确保存在本机 CLI 主体，并为其签发新的 access token。
   */
  ensureLocalCliAccess(input: {
    token_name: string;
    expires_at?: string;
  }): { user: AuthCurrentUserPayload; token: AuthIssuedToken } {
    const token = this.createLocalCliToken({
      name: input.token_name,
      expires_at: input.expires_at,
    });
    const user = this.requireLocalCliUser();
    return {
      user: this.toUserPayload(user),
      token,
    };
  }

  /**
   * 读取本机 CLI 主体的 token 列表。
   */
  listLocalCliTokens(): AuthTokenSummary[] {
    const user = this.store.findUserByUsername(LOCAL_CLI_USERNAME);
    if (!user) return [];
    return this.store
      .listTokensByUserId(user.id)
      .filter((item) => !item.revoked_at)
      .map((item) => this.store.toTokenSummary(item));
  }

  /**
   * 为本机 CLI 主体签发新的 access token。
   */
  createLocalCliToken(input: {
    name: string;
    expires_at?: string;
  }): AuthIssuedToken {
    const user = this.ensureLocalCliUser();
    const issued = this.issueTokenForUser({
      user,
      token_name: input.name,
      expires_at: input.expires_at,
    });
    this.store.insertAuditLog({
      actor_user_id: user.id,
      resource_type: "auth_token",
      resource_id: issued.record.id,
      action: "token_create",
      result: "success",
      meta_json: JSON.stringify({
        name: issued.record.name,
        source: "local-cli",
      }),
    });
    return issued.token;
  }

  /**
   * 删除本机 CLI 主体下的 token。
   */
  deleteLocalCliToken(tokenIdInput: string): void {
    const user = this.requireLocalCliUser();
    const record = this.requireLocalCliTokenRecord(tokenIdInput, user.id);
    const deleted = this.store.deleteToken(record.id);
    if (!deleted) throw new AuthError("Token not found", 404);
    this.store.insertAuditLog({
      actor_user_id: user.id,
      resource_type: "auth_token",
      resource_id: record.id,
      action: "token_delete",
      result: "success",
      meta_json: JSON.stringify({
        name: record.name,
        source: "local-cli",
      }),
    });
  }

  /**
   * 解析 Authorization 头并返回 principal。
   */
  authenticateBearerHeader(headerValue: string | undefined): AuthPrincipal {
    const plainToken = extractBearerToken(headerValue);
    if (!plainToken) throw new AuthError("Missing bearer token", 401);
    const record = this.store.findTokenByHash(hashAccessToken(plainToken));
    if (!record) throw new AuthError("Invalid bearer token", 401);
    if (record.revoked_at) throw new AuthError("Token is revoked", 401);
    if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
      throw new AuthError("Token is expired", 401);
    }
    const user = this.store.getUserById(record.user_id);
    if (!user) throw new AuthError("User not found for token", 401);
    this.ensureUserActive(user);
    this.store.touchToken(record.id);
    return {
      user_id: user.id,
      username: user.username,
      display_name: user.display_name,
      status: user.status,
      token_id: record.id,
      token_name: record.name,
      roles: this.store.listRoleNamesByUserId(user.id),
      permissions: this.store.listPermissionKeysByUserId(user.id),
    };
  }

  /**
   * 返回当前用户信息。
   */
  getCurrentUser(principal: AuthPrincipal): AuthCurrentUserPayload {
    return {
      id: principal.user_id,
      username: principal.username,
      display_name: principal.display_name,
      roles: [...principal.roles],
      permissions: [...principal.permissions],
    };
  }

  /**
   * 为当前 Bearer 调用主体创建新的 token。
   */
  createToken(principal: AuthPrincipal, input: {
    name: string;
    expires_at?: string;
  }): AuthIssuedToken {
    const user = this.store.getUserById(principal.user_id);
    if (!user) throw new AuthError("User not found", 404);
    const issued = this.issueTokenForUser({
      user,
      token_name: input.name,
      expires_at: input.expires_at,
    });
    this.store.insertAuditLog({
      actor_user_id: principal.user_id,
      actor_token_id: principal.token_id,
      resource_type: "auth_token",
      resource_id: issued.record.id,
      action: "token_create",
      result: "success",
      meta_json: JSON.stringify({ name: issued.record.name }),
    });
    return issued.token;
  }

  /**
   * 读取当前用户 token 列表。
   */
  listTokens(principal: AuthPrincipal): AuthTokenSummary[] {
    return this.store
      .listTokensByUserId(principal.user_id)
      .filter((item) => !item.revoked_at)
      .map((item) => this.store.toTokenSummary(item));
  }

  /**
   * 删除当前用户的 token。
   */
  deleteToken(principal: AuthPrincipal, tokenIdInput: string): void {
    const token_id = String(tokenIdInput || "").trim();
    if (!token_id) throw new AuthError("token_id is required", 400);
    const record = this.store.getTokenById(token_id);
    if (!record || record.user_id !== principal.user_id) {
      throw new AuthError("Token not found", 404);
    }
    const deleted = this.store.deleteToken(record.id);
    if (!deleted) throw new AuthError("Token not found", 404);
    this.store.insertAuditLog({
      actor_user_id: principal.user_id,
      actor_token_id: principal.token_id,
      resource_type: "auth_token",
      resource_id: token_id,
      action: "token_delete",
      result: "success",
      meta_json: JSON.stringify({ name: record.name }),
    });
  }

  private issueTokenForUser(params: {
    user: AuthUser;
    token_name: string;
    expires_at?: string;
  }): { record: ReturnType<AuthStore["createToken"]>; token: AuthIssuedToken } {
    const plainToken = generateAccessToken();
    const record = this.store.createToken({
      user_id: params.user.id,
      name: this.requireTokenName(params.token_name),
      token_hash: hashAccessToken(plainToken),
      expires_at: optionalTrimmedText(params.expires_at),
    });
    return {
      record,
      token: this.store.toIssuedToken(record, plainToken),
    };
  }

  private ensureUserActive(user: AuthUser): void {
    if (user.status !== "active") {
      throw new AuthError("User is disabled", 403);
    }
  }

  private isTokenActive(record: Pick<AuthTokenRecord, "revoked_at" | "expires_at">): boolean {
    if (record.revoked_at) return false;
    if (!record.expires_at) return true;
    return new Date(record.expires_at).getTime() > Date.now();
  }

  private ensureLocalCliUser(): AuthUser {
    this.store.ensureDefaultCatalog();
    const existing = this.store.findUserByUsername(LOCAL_CLI_USERNAME);
    if (existing) {
      this.ensureUserActive(existing);
      return existing;
    }
    const user = this.store.createUser({
      username: LOCAL_CLI_USERNAME,
      password_hash: LOCAL_CLI_PASSWORD_HASH,
      display_name: LOCAL_CLI_DISPLAY_NAME,
      status: "active",
    });
    this.store.assignRoleToUser({
      user_id: user.id,
      roleName: "admin",
    });
    return user;
  }

 private requireTokenName(value: string): string {
   const token_name = String(value || "").trim();
   if (!token_name) throw new AuthError("token name is required", 400);
   return token_name;
 }

 private requireLocalCliUser(): AuthUser {
    const user = this.store.findUserByUsername(LOCAL_CLI_USERNAME);
    if (!user) throw new AuthError("Local CLI access is not initialized", 404);
    this.ensureUserActive(user);
    return user;
  }

  private requireLocalCliTokenRecord(
    tokenIdInput: string,
    expectedUserId: string,
  ): AuthTokenRecord {
    const token_id = String(tokenIdInput || "").trim();
    if (!token_id) throw new AuthError("token_id is required", 400);
    const record = this.store.getTokenById(token_id);
    if (!record || record.user_id !== expectedUserId) {
      throw new AuthError("Token not found", 404);
    }
    return record;
  }

  private toUserPayload(user: AuthUser): AuthCurrentUserPayload {
    return {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      roles: this.store.listRoleNamesByUserId(user.id),
      permissions: this.store.listPermissionKeysByUserId(user.id),
    };
  }
}
