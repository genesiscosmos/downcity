/**
 * Accounts 登录与认证运行时。
 *
 * 本模块负责 Provider 选择、better-auth 调用、OAuth 登录编排和 User Token
 * 签发。数据库准备与过期流程维护由独立生命周期入口执行，实例初始化仅创建
 * 认证配置。数据库事实统一通过 AccountsStore 访问，HTTP 路由由 routes 模块注册。
 */

import { httpError, type ServiceInstallContext } from "@downcity/downtown";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { listAccountSessions, listAccountUsers } from "./admin-queries.js";
import { AccountsStore } from "./AccountsStore.js";
import { oauthErrorResponse } from "./oauth-pages.js";
import { LoginFlow } from "./LoginFlow.js";
import type { LoginFlowRow } from "./login-schema.js";
import type { AccountsLoginExchangeRequest } from "./types.js";
import {
  buildOAuthAuthorizeURL,
  readOAuthProviderId,
  resolveOAuthProfile,
  type OAuthProviderId,
} from "./oauth.js";
import {
  AUTH_ACCOUNT_TABLE,
  AUTH_SESSION_TABLE,
  AUTH_USER_TABLE,
  AUTH_VERIFICATION_TABLE,
  type UserProfileRow,
} from "./schema.js";
import type {
  AccountsEmailProvider,
  AccountsOAuthProvider,
  AccountsProviderContext,
  AccountsProviderItem,
  AccountsUsageRegistration,
} from "./types.js";
import type {
  AccountsRouteResult,
  AccountsRuntimeOptions,
} from "./types/AccountsRuntime.js";
import { readErrorMessage } from "./utils.js";
import { accounts_database_schemas } from "./database-schemas.js";

/** 本机登录使用的稳定用户 ID。 */
const LOCAL_USER_ID = "local-user";
/** 本机登录在 Provider Catalog 中的固定描述。 */
const LOCAL_PROVIDER: AccountsProviderItem = {
  id: "local",
  type: "input",
  enabled: true,
  label: "Local Account",
  inputs: [],
  login_enabled: true,
};

/** Accounts 服务内部登录运行时。 */
export class AccountsRuntime {
  /** better-auth 认证入口，在 Service 初始化阶段创建。 */
  private auth?: ReturnType<typeof betterAuth>;
  /** Accounts 数据库事实访问器。 */
  private readonly store: AccountsStore;

  /** 发起证明、Provider 浏览器绑定及授权码交换边界。 */
  readonly flow: LoginFlow;

  constructor(private readonly options: AccountsRuntimeOptions) {
    this.store = new AccountsStore(options.database);
    this.flow = new LoginFlow(options.database, options.service_options.trusted_web_callbacks);
  }

  /** 幂等准备数据库：作废旧登录状态，并确保 Provider 身份唯一索引存在。 */
  async prepare_database(): Promise<void> {
    await this.store.invalidate_legacy_logins();
  }

  /** 清理过期登录流程，由独立维护生命周期调用。 */
  async cleanup(): Promise<void> {
    await this.flow.cleanup();
  }

  /** 仅初始化 better-auth 及其 Provider 配置，不执行持久化维护。 */
  async initialize(): Promise<void> {
    this.auth = betterAuth({
      secret: this.options.read_env("BETTER_AUTH_SECRET"),
      database: drizzleAdapter(this.store.read_drizzle_database() as never, {
        provider: this.options.database.schema_id === "postgresql" ? "pg" : "sqlite",
        schema: {
          [AUTH_USER_TABLE]: accounts_database_schemas[this.options.database.schema_id]!.tables.auth_users,
          [AUTH_SESSION_TABLE]: accounts_database_schemas[this.options.database.schema_id]!.tables.auth_sessions,
          [AUTH_ACCOUNT_TABLE]: accounts_database_schemas[this.options.database.schema_id]!.tables.auth_accounts,
          [AUTH_VERIFICATION_TABLE]: accounts_database_schemas[this.options.database.schema_id]!.tables.auth_verifications,
        },
      }),
      baseURL: this.options.read_base_url(),
      basePath: "/v1/accounts/auth",
      user: { modelName: AUTH_USER_TABLE },
      account: {
        modelName: AUTH_ACCOUNT_TABLE,
        accountLinking: { enabled: false },
      },
      session: { modelName: AUTH_SESSION_TABLE },
      verification: { modelName: AUTH_VERIFICATION_TABLE },
      emailAndPassword: {
        enabled: Boolean(this.get_enabled_email_provider()),
        autoSignIn: false,
        requireEmailVerification: true,
      },
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: false,
        sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
          const provider = this.get_enabled_email_provider();
          if (!provider) throw new Error("Email provider is not configured");
          await provider.send_email({
            to: user.email,
            subject: "Verify your email for Downcity",
            text: `Verification: ${url}`,
          });
        },
      },
      // OAuth 使用带浏览器绑定和 PKCE 的 Accounts 流程。
      socialProviders: {},
    } as any);
  }

  /** 向 UsageService 投影注册用户及首次创建时间。 */
  async list_usage_account_registrations(): Promise<AccountsUsageRegistration[]> {
    return await this.store.list_usage_account_registrations();
  }

  /** 读取 better-auth 原生 HTTP Handler。 */
  get_auth_handler(): (request: Request) => Promise<Response> {
    return async (request) => {
      const path = new URL(request.url).pathname;
      // Native routes cannot bypass Accounts provider or login policies.
      if (!this.get_enabled_email_provider()
        || request.method !== "GET"
        || path !== "/v1/accounts/auth/verify-email") {
        return new Response("Not found", { status: 404 });
      }
      const result = await this.verify_email_account(this.install_context, {
        token: new URL(request.url).searchParams.get("token") ?? "",
      });
      return Response.json(result.body, { status: result.status ?? 200, headers: { "cache-control": "no-store" } });
    };
  }

  /** 当前服务是否启用本机账户登录。 */
  is_local_login_enabled(): boolean {
    return this.options.service_options.local_login === true;
  }

  /** 读取 User Token 的配置有效期。 */
  read_token_ttl(): string | undefined {
    return this.options.service_options.token_ttl;
  }

  /** Select a configured provider before allocating any login flow. */
  login_provider(provider_id: string): AccountsProviderItem | undefined {
    return this.list_visible_providers().find((provider) => provider.id === provider_id && provider.enabled);
  }

  /** 浏览器入口先绑定当前浏览器，再跳转 Provider。 */
  async authorize_oauth(login_id: string, request: Request): Promise<Response> {
    const row = await this.flow.read(login_id);
    const provider = readOAuthProviderId(row.provider);
    const config = provider ? this.get_enabled_oauth_provider_config(provider) : undefined;
    if (!config) return oauthErrorResponse("OAuth provider is not enabled");
    return await this.flow.authorize(login_id, request,
      (state) => buildOAuthAuthorizeURL(config, this.get_oauth_callback_url(), state));
  }

  /** 校验 Email 密码并签发 User Token。 */
  async create_email_login_token(
    ctx: ServiceInstallContext,
    input: { email?: unknown; password?: unknown },
  ): Promise<
    { provider: "email"; user_token: string; user_id?: string; email?: string }
    | { error: string; status: number }
  > {
    if (!this.get_enabled_email_provider()) {
      return { error: "email provider not configured", status: 400 };
    }
    const email = String(input.email ?? "").trim().toLowerCase();
    const password = String(input.password ?? "");
    if (!email || !password) return { error: "email and password required", status: 400 };

    try {
      const result = await this.require_auth().api.signInEmail({
        body: { email, password },
        asResponse: true,
      });
      if (!result.ok) {
        const error = await result.json().catch(() => ({})) as { message?: string };
        return { error: error.message ?? "invalid email or password", status: 401 };
      }
      const data = await result.json() as {
        /** Authenticated user returned by successful password verification. */
        user?: {
          /** Stable nonempty authentication identity. */
          id: string;
          /** Normalized primary email. */
          email: string;
          /** Explicitly verified ownership of the primary email. */
          emailVerified?: boolean;
          /** Optional display name. */
          name?: string;
          /** Optional avatar URL. */
          image?: string | null;
        };
      };
      const user_id = String(data.user?.id ?? "").trim();
      if (!user_id || !data.user?.email || data.user.emailVerified !== true) {
        return { error: "verified email authentication required", status: 401 };
      }
      if (user_id) {
        await this.store.upsert_profile({
          user_id,
          email: String(data.user?.email ?? ""),
          display_name: String(data.user?.name ?? data.user?.email?.split("@")[0] ?? ""),
          avatar_url: String(data.user?.image ?? ""),
        });
      }
      const user_token = await ctx.createUserToken({
        user_id,
        ttl: this.options.service_options.token_ttl,
      });
      return {
        provider: "email",
        user_token: user_token.user_token,
        user_id,
        email: data.user?.email,
      };
    } catch (error) {
      return { error: readErrorMessage(error), status: 500 };
    }
  }

  /** Sign a local token only after the route has validated the explicit local login policy. */
  async local_login_token(ctx: ServiceInstallContext): Promise<string> {
    if (!this.is_local_login_enabled()) throw new Error("local login is disabled");
    return (await this.create_local_login_token(ctx)).user_token;
  }

  /** 注册 Email 账号并触发验证邮件。 */
  async register_email_account(input: {
    email?: string;
    password?: string;
    name?: string;
  }): Promise<AccountsRouteResult> {
    if (!this.get_enabled_email_provider()) {
      return { body: { error: "email provider not configured" }, status: 400 };
    }
    const email = String(input.email ?? "").trim().toLowerCase();
    const password = String(input.password ?? "");
    if (!email || !email.includes("@")) {
      return { body: { error: "valid email required" }, status: 400 };
    }
    if (password.length < 8) {
      return { body: { error: "password must be at least 8 characters" }, status: 400 };
    }

    try {
      const result = await this.require_auth().api.signUpEmail({
        body: { email, password, name: input.name ?? email.split("@")[0] ?? "" },
        asResponse: true,
      });
      if (!result.ok) {
        const error = await result.json().catch(() => ({})) as { message?: string };
        return {
          body: { error: error.message ?? "registration failed" },
          status: result.status as number,
        };
      }
      const data = await result.json() as {
        token?: string;
        user?: { id: string; email: string; name?: string; image?: string | null };
      };
      if (data.user?.id) {
        await this.store.upsert_profile({
          user_id: data.user.id,
          email: data.user.email,
          display_name: String(data.user.name ?? data.user.email.split("@")[0] ?? ""),
          avatar_url: String(data.user.image ?? ""),
        });
      }
      return {
        body: {
          success: true,
          message: "verification email sent",
          user_id: data.user?.id,
        },
      };
    } catch (error) {
      return { body: { error: readErrorMessage(error) }, status: 500 };
    }
  }

  /** 验证邮箱所有权；验证完成后通过正常密码登录获取 User Token。 */
  async verify_email_account(
    _ctx: ServiceInstallContext,
    input: { token?: string },
  ): Promise<AccountsRouteResult> {
    if (!this.get_enabled_email_provider()) {
      return { body: { error: "email provider not configured" }, status: 400 };
    }
    const token = String(input.token ?? "").trim();
    if (!token) return { body: { error: "verification token required" }, status: 400 };

    try {
      const result = await this.require_auth().api.verifyEmail({
        query: { token },
        asResponse: true,
      });
      if (!result.ok) {
        return { body: { error: "email verification failed or expired" }, status: 400 };
      }
      const data = await result.json() as { /** Dependency verification confirmation flag. */ status?: boolean };
      if (data.status !== true) {
        return { body: { error: "email verification was not confirmed" }, status: 400 };
      }
      return { body: { success: true, message: "email verified; sign in with your password" } };
    } catch (error) {
      return { body: { error: readErrorMessage(error) }, status: 500 };
    }
  }

  /** 处理 OAuth Provider 回调并完成登录 state。 */
  async handle_oauth_callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (error) return oauthErrorResponse(url.searchParams.get("error_description") ?? error);

    try {
      if (!state || !code || url.searchParams.getAll("state").length !== 1
        || url.searchParams.getAll("code").length !== 1) throw new Error("Single OAuth state and code required");
      const entry = await this.flow.callback(state, request);
      const provider = readOAuthProviderId(String(entry.provider));
      if (!provider) throw new Error("Invalid OAuth provider");
      const profile = await resolveOAuthProfile(
        provider,
        this.get_enabled_oauth_provider_config(provider),
        code,
        this.get_oauth_callback_url(),
      );
      const user_id = await this.store.ensure_oauth_user(profile, request);
      return await this.flow.oauth_callback(entry, user_id);
    } catch (caught) {
      return oauthErrorResponse(readErrorMessage(caught));
    }
  }

  /** OAuth 必须通过产品回调授权码与 PKCE 校验，才签发 Token 并进入一次性交换。 */
  async exchange_login(row: LoginFlowRow, input: AccountsLoginExchangeRequest) {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(String(input.exchange_id ?? ""))) throw httpError(400, "random exchange_id required (20-128 URL-safe characters)");
    const oauth = row.provider !== "email" && row.provider !== "local";
    if (oauth && await this.flow.begin_oauth_exchange(row, String(input.authorization_code ?? ""), String(input.code_verifier ?? ""), input.exchange_id)) {
      try {
        if (!row.user_id) throw new Error("authenticated identity missing");
        const result = await this.create_user_token(row.user_id);
        await this.flow.ready(row.login_id, "issuing", result.user_token);
      } catch (reason) {
        await this.flow.retry_oauth_exchange(row.login_id, input.exchange_id);
        throw reason;
      }
    }
    const result = await this.flow.exchange(row, String(input.exchange_id ?? ""));
    // 网站由 BFF Cookie 持有独立登录；设备登录交付可续期会话。
    if (row.client_type === "web") return result;
    const credentials = await this.install_context.create_user_session(result.user_token, `${input.login_secret}:${input.exchange_id}`);
    return { ...result, ...credentials };
  }

  /** 返回产品侧当前可见的登录方式。 */
  list_visible_providers(): AccountsProviderItem[] {
    if (this.options.service_options.local_login) return [LOCAL_PROVIDER];
    return this.list_providers().filter((item) => item.enabled);
  }

  /** 读取当前用户 Profile。 */
  async read_profile(user_id: string): Promise<UserProfileRow | null> {
    return await this.store.read_profile(user_id);
  }

  /** 读取管理端账号列表。 */
  async list_account_users(): Promise<Record<string, unknown>[]> {
    return await listAccountUsers((sql) => this.store.prepare(sql));
  }

  /** 读取管理端认证 Session 列表。 */
  async list_account_sessions(): Promise<Record<string, unknown>[]> {
    return await listAccountSessions((sql) => this.store.prepare(sql));
  }

  /** 为 OAuth 流程签发 User Token。 */
  private async create_user_token(
    user_id: string,
  ): Promise<{ user_token: string }> {
    const ctx = this.install_context;
    return await ctx.createUserToken({
      user_id,
      ttl: this.options.service_options.token_ttl,
    });
  }

  /** 创建 Local User Token。 */
  private async create_local_login_token(
    ctx: ServiceInstallContext,
  ): Promise<{ provider: "local"; user_token: string; user_id: string }> {
    const user_token = await ctx.createUserToken({
      user_id: LOCAL_USER_ID,
      ttl: this.options.service_options.token_ttl,
    });
    return {
      provider: "local",
      user_token: user_token.user_token,
      user_id: LOCAL_USER_ID,
    };
  }

  /** 列出全部 Provider 的当前能力描述。 */
  private list_providers(): AccountsProviderItem[] {
    return this.options.providers.map((provider) => provider.method(this.get_provider_context()));
  }

  /** 构造 Provider 可读取的最小运行时上下文。 */
  private get_provider_context(): AccountsProviderContext {
    return { env: this.options.read_env };
  }

  /** 读取当前环境下已启用的 Email Provider。 */
  private get_enabled_email_provider(): AccountsEmailProvider | undefined {
    const provider = this.options.providers.find(
      (item): item is AccountsEmailProvider => item.id === "email" && item.type === "password",
    );
    if (!provider) return undefined;
    return provider.method(this.get_provider_context()).enabled ? provider : undefined;
  }

  /** 读取当前环境下已启用的 OAuth Provider 配置。 */
  private get_enabled_oauth_provider_config(provider_id: OAuthProviderId) {
    const provider = this.options.providers.find(
      (item): item is AccountsOAuthProvider => item.id === provider_id && item.type === "oauth",
    );
    if (!provider || !provider.method(this.get_provider_context()).enabled) return undefined;
    return provider.config(this.get_provider_context());
  }

  /** 读取当前 Federation 的 OAuth Callback URL。 */
  private get_oauth_callback_url(): string {
    return `${this.options.read_base_url()}/v1/accounts/oauth/callback`;
  }

  /** 读取已经完成 Service 安装的 Context。 */
  private get install_context(): ServiceInstallContext {
    return this.options.read_install_context();
  }

  /** 读取已经初始化的 better-auth 实例。 */
  private require_auth(): ReturnType<typeof betterAuth> {
    if (!this.auth) throw new Error("Accounts authentication runtime is not initialized");
    return this.auth;
  }
}
