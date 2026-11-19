/**
 * Downcity 官方 Accounts 服务。
 *
 * AccountsService 是 Federation 集成边界：声明 Schema 与环境需求，创建登录
 * 运行时并注册路由。数据库准备、定期维护和实例认证初始化使用独立生命周期，
 * Provider 选择、认证流程和持久化分别由内部模块负责。
 */

import { InstallableService } from "@downcity/federation";
import type { EnvRequirement, ServiceInstallContext, ServiceAvailability } from "@downcity/federation";
import { accounts_documentation } from "./documentation.js";
import { AccountsRuntime } from "./AccountsRuntime.js";
import { accounts_database_schemas } from "./database-schemas.js";
import { mergeAccountsEnvRequirements, normalizeAccountsProviders } from "./helpers.js";
import { register_accounts_routes } from "./routes.js";
import type {
  AccountsProvider,
  AccountsServiceOptions,
  AccountsUsageRegistration,
} from "./types.js";

export {
  emailAccountsProvider,
  githubAccountsProvider,
  googleAccountsProvider,
  oauthAccountsProvider,
  wechatAccountsProvider,
} from "./providers/index.js";

/** Accounts 服务自身环境变量需求。 */
const accounts_env: EnvRequirement[] = [
  { key: "BETTER_AUTH_SECRET", description: "better-auth signing secret", required: true },
];

export type { AccountsServiceOptions, AccountsUsageRegistration } from "./types.js";

/** Accounts 服务的 Federation 组合根。 */
export class AccountsService extends InstallableService {
  readonly id = "accounts";
  readonly name = "Accounts";
  readonly version = "0.4.0";
  readonly database_schemas = accounts_database_schemas;

  /** 已归一化的登录 Provider。 */
  private readonly providers: AccountsProvider[];
  /** 依赖注入后按需创建、生命周期跟随 Service 的登录运行时。 */
  private runtime?: AccountsRuntime;
  /** 路由安装时保存的上下文；数据库准备和维护不依赖该上下文。 */
  private install_context?: ServiceInstallContext;
  /** better-auth 实例初始化成功后才允许报告本地登录条件满足。 */
  private runtime_initialized = false;

  constructor(private readonly options: AccountsServiceOptions = {}) {
    const providers = normalizeAccountsProviders(options.providers ?? []);
    super(mergeAccountsEnvRequirements([
      ...accounts_env,
      ...providers.flatMap((provider) => provider.env),
    ]), {
      description: "Unified account identity, email/OAuth/local login, token issuance and rotating device sessions.",
      requirements: ["Prepared Accounts schema and Federation signing/authentication runtime", "BETTER_AUTH_SECRET", "Explicit login providers or local_login", "OAuth web callbacks must exactly match trusted_web_callbacks; CLI/Desktop require loopback callback and S256 PKCE"],
      availability: () => this.read_local_availability(),
    });
    this.providers = providers;
    this.instruction = ({ actions }) => [
      "提供 Downcity 的统一账号服务容器，具体登录方式由 email / phone / OAuth 等 provider 决定。",
      "provider 满足 required env 或 runtime 配置后，才会出现在 /providers 中供客户端使用。",
      "登录开始传 client_type。OAuth 必须绑定产品 redirect_uri、随机 state 与 S256 PKCE；网站回调必须精确匹配 trusted_web_callbacks，CLI/Desktop 使用本机 loopback。Provider 认证后自动回到产品，使用 authorization_code、code_verifier、login_secret 与 exchange_id 一次性交换 Token。状态查询不能交付 Token。",
      "OAuth 回调地址固定为 /v1/accounts/oauth/callback，服务会根据 Federation 公网地址生成完整回调 URL。",
      `当前暴露 ${actions.length} 个动作，常用流程由 /providers 返回的 provider 决定。`,
      "配置：准备数据库，设置 BETTER_AUTH_SECRET，并为已选 Provider 提供配置；Email 需要 send_email，OAuth 需要 client ID/secret 与正确公网回调地址。",
      "鉴权：providers/login/register/verify-email 是公开入口；me 要求 User Token；tokens/issue/users/sessions 要求 Admin Session。公开登录仍校验私密 proof、Origin/Cookie 或 OAuth code/PKCE。",
      "流程：providers → login/start → 输入 continue 或浏览器 OAuth → login/exchange。登录初始有效期五分钟；交换重试须在六十秒内复用 exchange_id。",
      "CLI/Desktop 交换交付可轮换设备会话：先保存 refresh_id，再用 refresh 刷新；logout 用 refresh_token 撤销整条设备会话，或用 Bearer Token 撤销当前 Token。",
      "限制：local_login 只适用于受控本机环境；邮箱验证不签发登录凭证；状态查询不能获取授权码、Token 或刷新凭证。",
    ].join("\n");
  }

  /** 保存安装上下文并注册 Accounts 路由，复用已创建的登录运行时。 */
  install(ctx: ServiceInstallContext): void {
    this.install_context = ctx;
    const documentation = Object.fromEntries(Object.entries(accounts_documentation).map(([path, entry]) => [path, {
      ...entry,
      availability: () => this.read_action_availability(path),
    }]));
    register_accounts_routes(this.require_runtime(), ctx, documentation);
  }

  /** 在显式数据库准备阶段幂等作废旧登录并建立身份唯一索引。 */
  protected override async on_prepare_database(): Promise<void> {
    await this.require_runtime().prepare_database();
  }

  /** 在独立维护阶段清理过期登录流程。 */
  protected override async on_maintenance(): Promise<void> {
    await this.require_runtime().cleanup();
  }

  /** 仅创建实例所需的 better-auth 认证配置。 */
  protected override async on_init(): Promise<void> {
    await this.require_runtime().initialize();
    this.runtime_initialized = true;
  }

  /** 向 UsageService 投影注册用户及首次创建时间。 */
  async list_usage_account_registrations(): Promise<AccountsUsageRegistration[]> {
    return await this.require_runtime().list_usage_account_registrations();
  }

  /** 读取 better-auth 原生 HTTP Handler。 */
  getAuthHandler(): (request: Request) => Promise<Response> {
    return this.require_runtime().get_auth_handler();
  }

  /** 处理 OAuth Provider 回调。 */
  async handleOAuthCallback(request: Request): Promise<Response> {
    return await this.require_runtime().handle_oauth_callback(request);
  }

  /** 基础读/管理入口不依赖登录 Provider；登录入口按所需 Provider 分类检查。 */
  private read_action_availability(path: string): ServiceAvailability {
    if (!this.install_context || !this._database || !this._authenticator) return { status: "unavailable", reason: "Accounts route, database or authentication runtime is not installed." };
    if (["/providers", "/me", "/users", "/sessions", "/tokens/issue", "/refresh", "/logout", "/login/result"].includes(path)) {
      return { status: "ready", reason: "Local Accounts route, database and authentication dependencies are installed; no login provider is required." };
    }
    if (!this.runtime_initialized || !this._env?.get("BETTER_AUTH_SECRET")) return { status: "unavailable", reason: "Accounts login runtime or required signing configuration is not initialized." };
    try {
      const methods = this.providers.map(provider => ({ type: provider.type, method: provider.method({ env: key => this._env?.get(key) }) }));
      if (["/register", "/verify-email", "/auth/*", "/login/continue"].includes(path)) {
        return methods.some(entry => entry.method.id === "email" && entry.method.enabled) && !this.options.local_login
          ? { status: "ready", reason: "Local email provider configuration is enabled; email transport is not probed." }
          : { status: "unavailable", reason: "Email login provider is not enabled in local configuration." };
      }
      if (["/oauth/authorize", "/oauth/callback"].includes(path)) {
        return methods.some(entry => entry.type === "oauth" && entry.method.enabled) && !this.options.local_login
          ? { status: "ready", reason: "At least one OAuth provider is locally configured; upstream connectivity and browser flow are not probed." }
          : { status: "unavailable", reason: "No OAuth provider is enabled in local configuration." };
      }
      return this.read_local_availability();
    } catch {
      return { status: "unknown", reason: "Local login provider configuration could not be evaluated." };
    }
  }

  /** 只检查安装状态与 Provider 的同步本地配置，不执行登录或上游网络请求。 */
  private read_local_availability(): ServiceAvailability {
    if (!this.install_context || !this._database || !this._authenticator || !this.runtime_initialized) {
      return { status: "unavailable", reason: "Accounts database, routes, authentication or login runtime is not initialized." };
    }
    if (!this._env?.get("BETTER_AUTH_SECRET")) return { status: "unavailable", reason: "Required Accounts signing configuration is missing." };
    if (this.options.local_login) return { status: "ready", reason: "Local-login runtime is initialized; host must restrict access to the intended local environment." };
    try {
      const methods = this.providers.map(provider => provider.method({ env: key => this._env?.get(key) }));
      const enabled_count = methods.filter(method => method.enabled).length;
      if (!enabled_count) return { status: "partial", reason: "Account read/admin routes are installed, but no login provider is enabled by local configuration." };
      if (enabled_count < methods.length) return { status: "partial", reason: "Some configured login providers are disabled by local configuration." };
      return { status: "ready", reason: "Login runtime and provider local configuration are available; provider connectivity is not probed." };
    } catch {
      return { status: "unknown", reason: "Local provider configuration could not be evaluated." };
    }
  }

  /** 依赖注入后按需创建运行时，允许数据库准备和维护先于路由安装执行。 */
  private require_runtime(): AccountsRuntime {
    this.runtime ??= new AccountsRuntime({
      service_options: this.options,
      providers: this.providers,
      database: this.require_service_database(),
      read_install_context: () => {
        if (!this.install_context) throw new Error("Accounts service routes are not installed");
        return this.install_context;
      },
      read_env: (key) => this._env?.get(key),
      read_base_url: () => this._baseURL,
    });
    return this.runtime;
  }
}
