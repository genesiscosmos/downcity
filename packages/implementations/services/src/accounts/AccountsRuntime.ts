/**
 * Accounts 登录与认证运行时。
 *
 * 本模块负责 Provider 选择、better-auth 调用、OAuth 登录编排和 User Token
 * 签发。数据库事实统一通过 AccountsStore 访问，HTTP 路由由 routes 模块注册。
 */

import type { ServiceInstallContext } from "@downcity/federation";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { listAccountSessions, listAccountUsers } from "./admin-queries.js";
import { AccountsStore } from "./AccountsStore.js";
import { oauthErrorResponse, oauthSuccessResponse } from "./oauth-pages.js";
import {
  buildOAuthAuthorizeURL,
  buildSocialProviders,
  readOAuthProviderId,
  resolveOAuthProfile,
  type OAuthProviderId,
} from "./oauth.js";
import {
  AUTH_ACCOUNT_TABLE,
  AUTH_SESSION_TABLE,
  AUTH_USER_TABLE,
  AUTH_VERIFICATION_TABLE,
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  type UserProfileRow,
} from "./schema.js";
import type { LoginStateRow } from "./rows.js";
import type {
  AccountsEmailProvider,
  AccountsLoginDoneResult,
  AccountsLoginInputRequiredResult,
  AccountsLoginRedirectRequiredResult,
  AccountsLoginResult,
  AccountsOAuthProvider,
  AccountsProviderContext,
  AccountsProviderItem,
  AccountsUsageRegistration,
} from "./types.js";
import type {
  AccountsRouteResult,
  AccountsRuntimeOptions,
} from "./types/AccountsRuntime.js";
import { randomToken, readErrorMessage } from "./utils.js";

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

  constructor(private readonly options: AccountsRuntimeOptions) {
    this.store = new AccountsStore(options.database);
  }

  /** 初始化 better-auth 及其 Provider 配置。 */
  initialize(): void {
    this.auth = betterAuth({
      secret: this.options.read_env("BETTER_AUTH_SECRET"),
      database: drizzleAdapter(this.store.read_drizzle_database() as never, {
        provider: "sqlite",
        schema: {
          [AUTH_USER_TABLE]: authUsers,
          [AUTH_SESSION_TABLE]: authSessions,
          [AUTH_ACCOUNT_TABLE]: authAccounts,
          [AUTH_VERIFICATION_TABLE]: authVerifications,
        },
      }),
      baseURL: this.options.read_base_url(),
      user: { modelName: AUTH_USER_TABLE },
      account: { modelName: AUTH_ACCOUNT_TABLE },
      session: { modelName: AUTH_SESSION_TABLE },
      verification: { modelName: AUTH_VERIFICATION_TABLE },
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
      },
      emailVerification: {
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
      socialProviders: buildSocialProviders(
        this.options.read_env,
        this.get_registered_oauth_provider_ids(),
      ),
    } as any);
  }

  /** 向 UsageService 投影注册用户及首次创建时间。 */
  async list_usage_account_registrations(): Promise<AccountsUsageRegistration[]> {
    return await this.store.list_usage_account_registrations();
  }

  /** 读取 better-auth 原生 HTTP Handler。 */
  get_auth_handler(): (request: Request) => Promise<Response> {
    return this.require_auth().handler;
  }

  /** 当前服务是否启用本机账户登录。 */
  is_local_login_enabled(): boolean {
    return this.options.service_options.local_login === true;
  }

  /** 读取 User Token 的配置有效期。 */
  read_token_ttl(): string | undefined {
    return this.options.service_options.token_ttl;
  }

  /** 校验 Bureau 当前可用于登录或 Token 签发。 */
  async require_active_bureau(bureau_id: string): Promise<void> {
    await this.options.require_active_bureau(bureau_id);
  }

  /** 读取未过期的登录 state。 */
  async read_login_state(state: string): Promise<LoginStateRow | null> {
    return await this.store.read_login_state(state);
  }

  /** 回填登录 state 的最终 User Token。 */
  async resolve_login_state(state: string, user_token: string): Promise<void> {
    await this.store.resolve_login_state(state, user_token);
  }

  /** 创建 OAuth 登录跳转结果。 */
  async create_oauth_start_result(
    bureau_id: string,
    provider: OAuthProviderId,
  ): Promise<{ data: AccountsLoginRedirectRequiredResult } | { error: string; status: number }> {
    const config = this.get_enabled_oauth_provider_config(provider);
    if (!config) return { error: "provider not configured", status: 400 };
    const login_id = randomToken(24);
    await this.store.create_login_state(bureau_id, provider, login_id);
    return {
      data: {
        status: "redirect_required",
        login_id,
        provider,
        url: buildOAuthAuthorizeURL(config, this.get_oauth_callback_url(), login_id),
        state: login_id,
      },
    };
  }

  /** 创建 Email 登录输入步骤。 */
  async start_email_login(
    bureau_id: string,
  ): Promise<{ data: AccountsLoginInputRequiredResult } | { error: string; status: number }> {
    const email_provider = this.get_enabled_email_provider();
    if (!email_provider) return { error: "email provider not configured", status: 400 };
    const login_id = randomToken(24);
    await this.store.create_login_state(bureau_id, "email", login_id);
    return {
      data: {
        status: "input_required",
        login_id,
        provider: "email",
        inputs: email_provider.method(this.get_provider_context()).inputs,
      },
    };
  }

  /** 校验 Email 密码并签发 User Token。 */
  async create_email_login_token(
    ctx: ServiceInstallContext,
    input: { email?: unknown; password?: unknown; bureau_id?: unknown },
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
        user?: { id: string; email: string; name?: string; image?: string | null };
      };
      const user_id = String(data.user?.id ?? "");
      if (user_id) {
        await this.store.upsert_profile({
          user_id,
          email: String(data.user?.email ?? ""),
          display_name: String(data.user?.name ?? data.user?.email?.split("@")[0] ?? ""),
          avatar_url: String(data.user?.image ?? ""),
        });
      }
      const user_token = await ctx.createUserToken({
        bureau_id: String(input.bureau_id ?? ""),
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

  /** 创建本机登录流程并立即写入签发结果。 */
  async start_local_login(
    ctx: ServiceInstallContext,
    bureau_id: string,
  ): Promise<AccountsLoginDoneResult> {
    const login_id = randomToken(24);
    const result = await this.create_local_login_token(ctx, bureau_id);
    await this.store.create_login_state(bureau_id, "local", login_id, result.user_token);
    return { status: "done", login_id, provider: "local" };
  }

  /** 读取登录流程的当前公开结果。 */
  async read_login_result(
    login_id: string,
  ): Promise<{ data: AccountsLoginResult } | { error: string; status: number }> {
    const entry = await this.store.read_login_state(login_id);
    if (!entry) return { error: "login expired or invalid", status: 404 };
    if (!entry.user_token) {
      return {
        data: { status: "pending", login_id, provider: entry.provider },
      };
    }
    return {
      data: {
        status: "done",
        login_id,
        provider: entry.provider,
        user_token: entry.user_token,
        user_id: entry.provider === "local" ? LOCAL_USER_ID : undefined,
      },
    };
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
          verification_token: data.token,
          user_id: data.user?.id,
        },
      };
    } catch (error) {
      return { body: { error: readErrorMessage(error) }, status: 500 };
    }
  }

  /** 验证 Email 并为指定 Bureau 签发 User Token。 */
  async verify_email_account(
    ctx: ServiceInstallContext,
    input: { token?: string; bureau_id?: string },
  ): Promise<AccountsRouteResult> {
    if (!this.get_enabled_email_provider()) {
      return { body: { error: "email provider not configured" }, status: 400 };
    }
    const token = String(input.token ?? "").trim();
    if (!token) return { body: { error: "verification token required" }, status: 400 };

    try {
      const result = await (this.require_auth().api as any).verifyEmail({
        body: { token },
        asResponse: true,
      });
      const data = await result.json() as {
        user?: { id: string; email: string; name?: string; image?: string | null };
      };
      const user_id = String(data.user?.id ?? "");
      if (user_id) {
        await this.store.upsert_profile({
          user_id,
          email: String(data.user?.email ?? ""),
          display_name: String(data.user?.name ?? data.user?.email?.split("@")[0] ?? ""),
          avatar_url: String(data.user?.image ?? ""),
        });
      }
      const user_token = await ctx.createUserToken({
        bureau_id: String(input.bureau_id ?? ""),
        user_id,
        ttl: this.options.service_options.token_ttl,
      });
      return { body: { user_token: user_token.user_token, user_id } };
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
      if (!state || !code) throw new Error("Missing state or code");
      const entry = await this.store.read_login_state(state);
      if (!entry) throw new Error("login expired or invalid");
      const provider = readOAuthProviderId(String(entry.provider));
      if (!provider) throw new Error("Invalid OAuth provider");
      const profile = await resolveOAuthProfile(
        provider,
        this.get_enabled_oauth_provider_config(provider),
        code,
        this.get_oauth_callback_url(),
      );
      const user_id = await this.store.ensure_oauth_user(profile, request);
      const result = await this.create_user_token(entry.bureau_id, user_id);
      await this.store.resolve_login_state(state, result.user_token);
    } catch (caught) {
      return oauthErrorResponse(readErrorMessage(caught));
    }
    return oauthSuccessResponse();
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
    bureau_id: string,
    user_id: string,
  ): Promise<{ user_token: string }> {
    const ctx = this.install_context;
    return await ctx.createUserToken({
      bureau_id,
      user_id,
      ttl: this.options.service_options.token_ttl,
    });
  }

  /** 创建 Local User Token。 */
  private async create_local_login_token(
    ctx: ServiceInstallContext,
    bureau_id: string,
  ): Promise<{ provider: "local"; user_token: string; user_id: string }> {
    const user_token = await ctx.createUserToken({
      bureau_id,
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

  /** 读取已注册 OAuth Provider ID。 */
  private get_registered_oauth_provider_ids(): OAuthProviderId[] {
    return this.options.providers
      .filter((provider): provider is AccountsOAuthProvider => provider.type === "oauth")
      .map((provider) => provider.id);
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
    return this.options.install_context;
  }

  /** 读取已经初始化的 better-auth 实例。 */
  private require_auth(): ReturnType<typeof betterAuth> {
    if (!this.auth) throw new Error("Accounts authentication runtime is not initialized");
    return this.auth;
  }
}
