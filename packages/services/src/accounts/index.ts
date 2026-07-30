/**
 * Downcity 官方 Accounts 服务。
 *
 * 设计边界：
 * - better-auth 作为认证事实源，统一落到 `auth_users/auth_accounts/auth_sessions/auth_verifications`
 * - 服务自己只维护 `auth_profiles`
 * - OAuth 使用自定义 callback 外壳，最终统一回填到 login state
 */

import { InstallableService } from "@downcity/city";
import type {
  EnvRequirement,
  ServiceDatabaseContext,
  ServiceInstallContext,
} from "@downcity/city";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { readPreparedFirst, runPrepared } from "./db.js";
import { mergeAccountsEnvRequirements, normalizeAccountsProviders } from "./helpers.js";
import { listAccountSessions, listAccountUsers } from "./admin-queries.js";
import { oauthErrorResponse, oauthSuccessResponse } from "./oauth-pages.js";
import {
  normalizeBool,
  prefixedId,
  randomToken,
  readErrorMessage,
  toRecord,
} from "./utils.js";
import {
  ACCOUNTS_LOGIN_STATE_TABLE,
  AUTH_ACCOUNT_TABLE,
  AUTH_SESSION_TABLE,
  AUTH_USER_TABLE,
  AUTH_VERIFICATION_TABLE,
  USER_PROFILE_TABLE,
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  accountsLoginStates,
  userProfiles,
  type UserProfileRow,
} from "./schema.js";
import {
  buildOAuthAuthorizeURL,
  buildSocialProviders,
  readOAuthProviderId,
  resolveOAuthProfile,
  type OAuthProviderId,
  type OAuthProviderProfile,
} from "./oauth.js";
import type { AuthAccountRow, AuthUserRow, LoginStateRow } from "./rows.js";
import type {
  AccountsLoginContinueRequest,
  AccountsLoginDoneResult,
  AccountsLoginInputRequiredResult,
  AccountsLoginRedirectRequiredResult,
  AccountsLoginResult,
  AccountsLoginStartRequest,
  AccountsEmailProvider,
  AccountsProvider,
  AccountsProviderContext,
  AccountsProviderItem,
  AccountsServiceOptions,
  AccountsOAuthProvider,
} from "./types.js";
import type { AccountsPreparedStatement } from "./types/DatabaseStatement.js";

export {
  emailAccountsProvider,
  githubAccountsProvider,
  googleAccountsProvider,
  oauthAccountsProvider,
  wechatAccountsProvider,
} from "./providers/index.js";

const LOGIN_STATE_TTL_MS = 5 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_USER_ID = "local-user";
const LOCAL_PROVIDER: AccountsProviderItem = {
  id: "local",
  type: "input",
  enabled: true,
  label: "Local Account",
  inputs: [],
  login_enabled: true,
};

/**
 * Accounts 服务自身 env。
 */
const accountsEnv: EnvRequirement[] = [
  { key: "BETTER_AUTH_SECRET", description: "better-auth signing secret", required: true },
];

export type { AccountsServiceOptions } from "./types.js";

export class AccountsService extends InstallableService {
  readonly id = "accounts";
  readonly name = "Accounts";
  readonly version = "0.4.0";
  readonly schema = {
    profile: userProfiles,
    login_states: accountsLoginStates,
    auth_users: authUsers,
    auth_sessions: authSessions,
    auth_accounts: authAccounts,
    auth_verifications: authVerifications,
  };

  private auth!: ReturnType<typeof betterAuth>;
  private readonly providers: AccountsProvider[];
  private database?: ServiceDatabaseContext;

  constructor(private readonly options: AccountsServiceOptions = {}) {
    const providers = normalizeAccountsProviders(options.providers ?? []);
    super(mergeAccountsEnvRequirements([
      ...accountsEnv,
      ...providers.flatMap((provider) => provider.env),
    ]));
    this.providers = providers;
    this.instruction = ({ actions }) => [
      "提供 Downcity 的统一账号服务容器，具体登录方式由 email / phone / OAuth 等 provider 决定。",
      "provider 满足 required env 或 runtime 配置后，才会出现在 /providers 中供客户端使用。",
      "登录成功时传入 city_id 后，通过 login/result 读取绑定该 city 的 City user_token。",
      "OAuth 回调地址固定为 /v1/accounts/oauth/callback，服务会根据 City 公网地址生成完整回调 URL。",
      `当前暴露 ${actions.length} 个动作，常用流程由 /providers 返回的 provider 决定。`,
    ].join("\n");
  }

  protected override async on_init(): Promise<void> {
    this.auth = betterAuth({
      secret: this._env?.get("BETTER_AUTH_SECRET"),
      database: drizzleAdapter(this.readDrizzleDb() as never, {
        provider: "sqlite",
        schema: {
          [AUTH_USER_TABLE]: authUsers,
          [AUTH_SESSION_TABLE]: authSessions,
          [AUTH_ACCOUNT_TABLE]: authAccounts,
          [AUTH_VERIFICATION_TABLE]: authVerifications,
        },
      }),
      baseURL: this._baseURL,
      user: {
        modelName: AUTH_USER_TABLE,
      },
      account: {
        modelName: AUTH_ACCOUNT_TABLE,
      },
      session: {
        modelName: AUTH_SESSION_TABLE,
      },
      verification: {
        modelName: AUTH_VERIFICATION_TABLE,
      },
      emailAndPassword: {
        enabled: true,
        autoSignIn: false,
      },
      emailVerification: {
        sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
          const provider = this.getEnabledEmailProvider();
          if (!provider) throw new Error("Email provider is not configured");
          await provider.send_email({
            to: user.email,
            subject: "Verify your email for Downcity",
            text: `Verification: ${url}`,
          });
        },
      },
      socialProviders: buildSocialProviders((key: string) => this._env?.get(key), this.getRegisteredOAuthProviderIds()),
    } as any);
  }

  install(ctx: ServiceInstallContext): void {
    this.database = ctx.database;
    ctx.route({
      method: "POST",
      path: "/login/start",
      public: true,
      handler: async (c) => {
        const body = await c.json<AccountsLoginStartRequest>();
        const provider = String(body.provider ?? "").trim();
        const city_id = String(body.city_id ?? "").trim() || "city_downcity";

        if (!provider) {
          return c.jsonResponse({ error: "provider required" }, 400);
        }

        if (provider === "local") {
          if (!this.options.local_login) {
            return c.jsonResponse({ error: "local login is not enabled" }, 404);
          }
          const result = await this.startLocalLogin(ctx, city_id);
          return c.jsonResponse(result);
        }

        if (provider === "email") {
          const result = await this.startEmailLogin(city_id);
          if ("error" in result) {
            return c.jsonResponse({ error: result.error }, result.status);
          }
          return c.jsonResponse(result.data);
        }

        const oauth_provider = readOAuthProviderId(provider);
        if (!oauth_provider) {
          return c.jsonResponse({ error: "provider not supported" }, 400);
        }

        const result = await this.createOAuthStartResult(city_id, oauth_provider);
        if ("error" in result) {
          return c.jsonResponse({ error: result.error }, result.status);
        }
        return c.jsonResponse(result.data);
      },
    });

    ctx.route({
      method: "POST",
      path: "/login/continue",
      public: true,
      handler: async (c) => {
        const body = await c.json<AccountsLoginContinueRequest>();
        const login_id = String(body.login_id ?? "").trim();
        if (!login_id) return c.jsonResponse({ error: "login_id required" }, 400);

        const entry = await this.readLoginState(login_id);
        if (!entry) return c.jsonResponse({ error: "login expired or invalid" }, 404);

        if (entry.provider === "email") {
          const input = toRecord(body.input);
          const result = await this.createEmailLoginToken(ctx, {
            email: input ? String(input.email ?? "") : "",
            password: input ? String(input.password ?? "") : "",
            city_id: entry.city_id,
          });
          if ("error" in result) {
            return c.jsonResponse({ error: result.error }, result.status);
          }
          await this.resolveLoginState(login_id, result.user_token);
          return c.jsonResponse({
            status: "done",
            login_id,
            provider: "email",
          });
        }

        if (entry.provider === "local") {
          return c.jsonResponse({
            status: entry.user_token ? "done" : "pending",
            login_id,
            provider: "local",
          });
        }

        return c.jsonResponse({ error: "login does not accept input" }, 400);
      },
    });

    ctx.route({
      method: "GET",
      path: "/login/result",
      public: true,
      handler: async (c) => {
        const login_id = String(new URL(c.request.url).searchParams.get("login_id") ?? "").trim();
        if (!login_id) return c.jsonResponse({ error: "login_id required" }, 400);

        const result = await this.readLoginResult(login_id);
        if ("error" in result) {
          return c.jsonResponse({ error: result.error }, result.status);
        }
        return c.jsonResponse(result.data);
      },
    });

    ctx.route({
      method: "ALL",
      path: "/auth/*",
      public: true,
      handler: {
        request: (request) => this.auth.handler(request),
      },
    });

    ctx.route({
      method: "GET",
      path: "/oauth/callback",
      public: true,
      handler: {
        request: (request) => this.handleOAuthCallback(request),
      },
    });

    ctx.route({
      method: "POST",
      path: "/register",
      public: true,
      handler: async (c) => {
        const email_provider = this.getEnabledEmailProvider();
        if (!email_provider) {
          return c.jsonResponse({ error: "email provider not configured" }, 400);
        }

        const body = await c.json<{ email?: string; password?: string; name?: string }>();
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");

        if (!email || !email.includes("@")) {
          return c.jsonResponse({ error: "valid email required" }, 400);
        }
        if (password.length < 8) {
          return c.jsonResponse({ error: "password must be at least 8 characters" }, 400);
        }

        try {
          const result = await this.auth.api.signUpEmail({
            body: { email, password, name: body.name ?? email.split("@")[0] ?? "" },
            asResponse: true,
          });

          if (!result.ok) {
            const err = await result.json().catch(() => ({})) as { message?: string };
            return c.jsonResponse({ error: err.message ?? "registration failed" }, result.status as number);
          }

          const data = await result.json() as { token?: string; user?: { id: string; email: string; name?: string; image?: string | null } };
          if (data.user?.id) {
            await this.upsertProfile({
              user_id: data.user.id,
              email: data.user.email,
              display_name: String(data.user.name ?? data.user.email.split("@")[0] ?? ""),
              avatar_url: String(data.user.image ?? ""),
            });
          }

          return c.jsonResponse({
            success: true,
            message: "verification email sent",
            verification_token: data.token,
            user_id: data.user?.id,
          });
        } catch (e) {
          return c.jsonResponse({ error: readErrorMessage(e) }, 500);
        }
      },
    });

    ctx.route({
      method: "POST",
      path: "/verify-email",
      public: true,
      handler: async (c) => {
        const email_provider = this.getEnabledEmailProvider();
        if (!email_provider) {
          return c.jsonResponse({ error: "email provider not configured" }, 400);
        }

        const body = await c.json<{ token?: string; city_id?: string }>();
        const token = String(body.token ?? "").trim();
        if (!token) return c.jsonResponse({ error: "verification token required" }, 400);

        try {
          const result = await (this.auth.api as any).verifyEmail({
            body: { token },
            asResponse: true,
          });
          const data = await result.json() as { user?: { id: string; email: string; name?: string; image?: string | null } };
          const user_id = String(data.user?.id ?? "");

          if (user_id) {
            await this.upsertProfile({
              user_id,
              email: String(data.user?.email ?? ""),
              display_name: String(data.user?.name ?? data.user?.email?.split("@")[0] ?? ""),
              avatar_url: String(data.user?.image ?? ""),
            });
          }

          const userToken = await ctx.createUserToken({
            city_id: String(body.city_id ?? ""),
            user_id,
            ttl: this.options.token_ttl,
          });

          return c.jsonResponse({ user_token: userToken.user_token, user_id });
        } catch (e) {
          return c.jsonResponse({ error: readErrorMessage(e) }, 500);
        }
      },
    });

    ctx.route({
      method: "GET",
      path: "/providers",
      public: true,
      handler: async (c) => c.jsonResponse({ items: this.listVisibleProviders() }),
    });

    ctx.route({
      method: "GET",
      path: "/me",
      auth: ["user"],
      handler: async (c) => {
        const user_id = String(c.user?.user_id ?? "");
        return c.jsonResponse({
          user: c.user,
          profile: user_id ? await this.readProfile(user_id) : null,
        });
      },
    });

    ctx.route({
      method: "POST",
      path: "/logout",
      auth: ["user"],
      handler: async (c) => c.jsonResponse({ success: true }),
    });

    ctx.route({
      method: "GET",
      path: "/users",
      auth: ["admin"],
      handler: async (c) => {
        try {
          return c.jsonResponse({ items: await listAccountUsers((sql) => this.rawPrepare(sql)) });
        } catch {
          return c.jsonResponse({ items: [] });
        }
      },
    });

    ctx.route({
      method: "GET",
      path: "/sessions",
      auth: ["admin"],
      handler: async (c) => {
        try {
          return c.jsonResponse({ items: await listAccountSessions((sql) => this.rawPrepare(sql)) });
        } catch {
          return c.jsonResponse({ items: [] });
        }
      },
    });
  }

  getAuthHandler() {
    return this.auth.handler;
  }

  /**
   * OAuth 回调处理。
   */
  async handleOAuthCallback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";

    if (error) {
      const desc = url.searchParams.get("error_description") ?? error;
      return oauthErrorResponse(desc);
    }

    try {
      if (!state || !code) throw new Error("Missing state or code");

      const entry = await this.readLoginState(state);
      if (!entry) throw new Error("login expired or invalid");

      const provider = readOAuthProviderId(String(entry.provider));
      if (!provider) throw new Error("Invalid OAuth provider");

      const profile = await resolveOAuthProfile(
        provider,
        this.getEnabledOAuthProviderConfig(provider),
        code,
        this.getOAuthCallbackURL(),
      );
      const authUserId = await this.ensureOAuthAuthUser(profile, request);
      const result = await this._authenticator!.createToken({
        city_id: entry.city_id,
        user_id: authUserId,
        ttl: this.options.token_ttl,
      });
      await this.resolveLoginState(state, result.user_token);
    } catch (e) {
      return oauthErrorResponse(readErrorMessage(e));
    }

    return oauthSuccessResponse();
  }

  private async createOAuthStartResult(
    city_id: string,
    provider: OAuthProviderId,
  ): Promise<{ data: AccountsLoginRedirectRequiredResult } | { error: string; status: number }> {
    const config = this.getEnabledOAuthProviderConfig(provider);
    if (!config) {
      return { error: "provider not configured", status: 400 };
    }

    const login_id = randomToken(24);
    await this.createLoginState(city_id, provider, login_id);
    return {
      data: {
        status: "redirect_required",
        login_id,
        provider,
        url: buildOAuthAuthorizeURL(config, this.getOAuthCallbackURL(), login_id),
        state: login_id,
      },
    };
  }

  private async startEmailLogin(city_id: string): Promise<{ data: AccountsLoginInputRequiredResult } | { error: string; status: number }> {
    const email_provider = this.getEnabledEmailProvider();
    if (!email_provider) {
      return { error: "email provider not configured", status: 400 };
    }

    const login_id = randomToken(24);
    await this.createLoginState(city_id, "email", login_id);
    return {
      data: {
        status: "input_required",
        login_id,
        provider: "email",
        inputs: email_provider.method(this.getProviderContext()).inputs,
      },
    };
  }

  private async createEmailLoginToken(
    ctx: ServiceInstallContext,
    input: {
      email?: unknown;
      password?: unknown;
      city_id?: unknown;
    },
  ): Promise<{ provider: "email"; user_token: string; user_id?: string; email?: string } | { error: string; status: number }> {
    const email_provider = this.getEnabledEmailProvider();
    if (!email_provider) {
      return { error: "email provider not configured", status: 400 };
    }

    const email = String(input.email ?? "").trim().toLowerCase();
    const password = String(input.password ?? "");

    if (!email || !password) {
      return { error: "email and password required", status: 400 };
    }

    try {
      const result = await this.auth.api.signInEmail({
        body: { email, password },
        asResponse: true,
      });

      if (!result.ok) {
        const err = await result.json().catch(() => ({})) as { message?: string };
        return { error: err.message ?? "invalid email or password", status: 401 };
      }

      const data = await result.json() as { user?: { id: string; email: string; name?: string; image?: string | null } };
      const user_id = String(data.user?.id ?? "");
      if (user_id) {
        await this.upsertProfile({
          user_id,
          email: String(data.user?.email ?? ""),
          display_name: String(data.user?.name ?? data.user?.email?.split("@")[0] ?? ""),
          avatar_url: String(data.user?.image ?? ""),
        });
      }

      const userToken = await ctx.createUserToken({
        city_id: String(input.city_id ?? ""),
        user_id,
        ttl: this.options.token_ttl,
      });

      return {
        provider: "email",
        user_token: userToken.user_token,
        user_id,
        email: data.user?.email,
      };
    } catch (e) {
      return { error: readErrorMessage(e), status: 500 };
    }
  }

  private async startLocalLogin(
    ctx: ServiceInstallContext,
    city_id: string,
  ): Promise<AccountsLoginDoneResult> {
    const login_id = randomToken(24);
    const result = await this.createLocalLoginToken(ctx, city_id);
    await this.createLoginState(city_id, "local", login_id, result.user_token);

    return {
      status: "done",
      login_id,
      provider: "local",
    };
  }

  private async createLocalLoginToken(
    ctx: ServiceInstallContext,
    city_id: string,
  ): Promise<{ provider: "local"; user_token: string; user_id: string }> {
    const userToken = await ctx.createUserToken({
      city_id,
      user_id: LOCAL_USER_ID,
      ttl: this.options.token_ttl,
    });

    return {
      provider: "local",
      user_token: userToken.user_token,
      user_id: LOCAL_USER_ID,
    };
  }

  private async readLoginResult(login_id: string): Promise<{ data: AccountsLoginResult } | { error: string; status: number }> {
    const entry = await this.readLoginState(login_id);
    if (!entry) return { error: "login expired or invalid", status: 404 };
    if (!entry.user_token) {
      return {
        data: {
          status: "pending",
          login_id,
          provider: entry.provider,
        },
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

  /**
   * 列出可用登录方式。
   */
  private listProviders(): AccountsProviderItem[] {
    return this.providers.map((provider) => provider.method(this.getProviderContext()));
  }

  /**
   * 返回产品侧可见登录方式。
   */
  private listVisibleProviders(): AccountsProviderItem[] {
    if (this.options.local_login) {
      return [LOCAL_PROVIDER];
    }
    return this.listProviders().filter((item) => item.enabled);
  }

  /**
   * 获取 provider 上下文。
   */
  private getProviderContext(): AccountsProviderContext {
    return {
      env: (key: string) => this._env?.get(key),
    };
  }

  /**
   * 获取已注册的 OAuth provider ID。
   */
  private getRegisteredOAuthProviderIds(): OAuthProviderId[] {
    return this.providers
      .filter((provider): provider is AccountsOAuthProvider => provider.type === "oauth")
      .map((provider) => provider.id);
  }

  /**
   * 获取已启用的 email provider。
   */
  private getEnabledEmailProvider(): AccountsEmailProvider | undefined {
    const provider = this.providers.find((item): item is AccountsEmailProvider => item.id === "email" && item.type === "password");
    if (!provider) return undefined;
    return provider.method(this.getProviderContext()).enabled ? provider : undefined;
  }

  /**
   * 获取已启用 OAuth provider 配置。
   */
  private getEnabledOAuthProviderConfig(provider_id: OAuthProviderId) {
    const provider = this.providers.find((item): item is AccountsOAuthProvider => item.id === provider_id && item.type === "oauth");
    if (!provider) return undefined;
    if (!provider.method(this.getProviderContext()).enabled) return undefined;
    return provider.config(this.getProviderContext());
  }

  /**
   * 当前请求环境下的 OAuth callback URL。
   */
  private getOAuthCallbackURL(): string {
    return `${this._baseURL}/v1/accounts/oauth/callback`;
  }

  /**
   * 确保 OAuth 用户落库到 better-auth 认证表，并同步 `auth_profiles`。
   */
  private async ensureOAuthAuthUser(profile: OAuthProviderProfile, request: Request): Promise<string> {
    const now = new Date().toISOString();
    const email = profile.email.trim().toLowerCase();

    const existingAccount = await readPreparedFirst(
      this.rawPrepare(`SELECT id, userId FROM ${AUTH_ACCOUNT_TABLE} WHERE providerId = ? AND accountId = ? LIMIT 1`),
      [profile.provider, profile.provider_user_id],
    ) as AuthAccountRow | null;

    let user = existingAccount
      ? await this.findAuthUserById(existingAccount.userId)
      : email
        ? await this.findAuthUserByEmail(email)
        : null;

    if (!user) {
      user = {
        id: prefixedId("usr"),
        email,
        emailVerified: profile.email_verified ? 1 : 0,
        name: profile.display_name,
        image: profile.avatar_url || null,
        createdAt: now,
        updatedAt: now,
      };
      await runPrepared(
        this.rawPrepare(`INSERT INTO ${AUTH_USER_TABLE} (id, email, emailVerified, name, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`),
        [user.id, user.email, normalizeBool(user.emailVerified), user.name, user.image, user.createdAt, user.updatedAt],
      );
    } else {
      user = {
        ...user,
        email,
        emailVerified: normalizeBool(user.emailVerified) || profile.email_verified ? 1 : 0,
        name: profile.display_name || user.name,
        image: profile.avatar_url || user.image,
        updatedAt: now,
      };
      await runPrepared(
        this.rawPrepare(`UPDATE ${AUTH_USER_TABLE} SET email = ?, emailVerified = ?, name = ?, image = ?, updatedAt = ? WHERE id = ?`),
        [user.email, normalizeBool(user.emailVerified), user.name, user.image, user.updatedAt, user.id],
      );
    }

    if (!existingAccount) {
      await runPrepared(
        this.rawPrepare(`INSERT INTO ${AUTH_ACCOUNT_TABLE} (id, accountId, providerId, userId, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
        [
          prefixedId("acc"),
          profile.provider_user_id,
          profile.provider,
          user.id,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          now,
          now,
        ],
      );
    } else {
      await runPrepared(
        this.rawPrepare(`UPDATE ${AUTH_ACCOUNT_TABLE} SET updatedAt = ? WHERE id = ?`),
        [now, existingAccount.id],
      );
    }

    await runPrepared(
      this.rawPrepare(`INSERT INTO ${AUTH_SESSION_TABLE} (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      [
        prefixedId("sess"),
        new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString(),
        randomToken(32),
        now,
        now,
        String(request.headers.get("x-forwarded-for") ?? ""),
        String(request.headers.get("user-agent") ?? ""),
        user.id,
      ],
    );

    await this.upsertProfile({
      user_id: user.id,
      email,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
    });

    return user.id;
  }

  /**
   * 创建登录 state。
   */
  private async createLoginState(city_id: string, provider: string, state: string, user_token = ""): Promise<void> {
    await runPrepared(
      this.rawPrepare(`INSERT INTO ${ACCOUNTS_LOGIN_STATE_TABLE} (state, city_id, provider, user_token, created_at) VALUES (?, ?, ?, ?, ?)`),
      [state, city_id, provider, user_token, Date.now()],
    );
  }

  /**
   * 读取登录 state。
   */
  private async readLoginState(state: string): Promise<LoginStateRow | null> {
    const row = await readPreparedFirst(
      this.rawPrepare(`SELECT state, city_id, provider, user_token, created_at FROM ${ACCOUNTS_LOGIN_STATE_TABLE} WHERE state = ?`),
      [state],
    ) as LoginStateRow | null;
    if (!row) return null;
    if (Date.now() - Number(row.created_at) > LOGIN_STATE_TTL_MS) {
      await runPrepared(this.rawPrepare(`DELETE FROM ${ACCOUNTS_LOGIN_STATE_TABLE} WHERE state = ?`), [state]);
      return null;
    }
    return row;
  }

  /**
   * 回填登录 state 的 City token。
   */
  private async resolveLoginState(state: string, user_token: string): Promise<void> {
    await runPrepared(
      this.rawPrepare(`UPDATE ${ACCOUNTS_LOGIN_STATE_TABLE} SET user_token = ? WHERE state = ?`),
      [user_token, state],
    );
  }

  /**
   * 按 ID 读取认证用户。
   */
  private async findAuthUserById(user_id: string): Promise<AuthUserRow | null> {
    return await readPreparedFirst(
      this.rawPrepare(`SELECT id, email, emailVerified, name, image, createdAt, updatedAt FROM ${AUTH_USER_TABLE} WHERE id = ? LIMIT 1`),
      [user_id],
    ) as AuthUserRow | null;
  }

  /**
   * 按邮箱读取认证用户。
   */
  private async findAuthUserByEmail(email: string): Promise<AuthUserRow | null> {
    return await readPreparedFirst(
      this.rawPrepare(`SELECT id, email, emailVerified, name, image, createdAt, updatedAt FROM ${AUTH_USER_TABLE} WHERE lower(email) = ? LIMIT 1`),
      [email.toLowerCase()],
    ) as AuthUserRow | null;
  }

  /**
   * 读取一条 user profile。
   */
  private async readProfile(user_id: string): Promise<UserProfileRow | null> {
    return await readPreparedFirst(
      this.rawPrepare(`SELECT user_id, email, display_name, avatar_url, bio, created_at, updated_at FROM ${USER_PROFILE_TABLE} WHERE user_id = ? LIMIT 1`),
      [user_id],
    ) as UserProfileRow | null;
  }

  /**
   * upsert user profile。
   */
  private async upsertProfile(input: {
    user_id: string;
    email: string;
    display_name: string;
    avatar_url: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.readProfile(input.user_id);
    if (existing) {
      await runPrepared(
        this.rawPrepare(`UPDATE ${USER_PROFILE_TABLE} SET email = ?, display_name = ?, avatar_url = ?, updated_at = ? WHERE user_id = ?`),
        [
          input.email || existing.email,
          input.display_name || existing.display_name,
          input.avatar_url || existing.avatar_url,
          now,
          input.user_id,
        ],
      );
      return;
    }

    await runPrepared(
      this.rawPrepare(`INSERT INTO ${USER_PROFILE_TABLE} (user_id, email, display_name, avatar_url, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
      [input.user_id, input.email, input.display_name, input.avatar_url, "", now, now],
    );
  }

  private rawPrepare(sql: string): AccountsPreparedStatement {
    const database = this.require_database();
    return {
      bind: (...params: unknown[]) => ({
        first: async () => (await database.query({ sql, params })).rows[0] ?? null,
        all: async () => ({ results: (await database.query({ sql, params })).rows }),
        run: async () => await database.query({ sql, params }),
      }),
    };
  }

  private readDrizzleDb(): ServiceDatabaseContext["drizzle"] {
    return this.require_database().drizzle;
  }

  private require_database(): ServiceDatabaseContext {
    if (!this.database) throw new Error("Accounts service database is not ready");
    return this.database;
  }
}
