/**
 * Downcity 官方 Accounts 服务。
 *
 * AccountsService 是 Federation 集成边界：声明 Schema 与环境需求，创建登录
 * 运行时并注册路由。Provider 选择、认证流程和持久化分别由内部模块负责。
 */

import { httpError, InstallableService } from "@downcity/federation";
import type { EnvRequirement, ServiceInstallContext } from "@downcity/federation";
import { AccountsRuntime } from "./AccountsRuntime.js";
import { mergeAccountsEnvRequirements, normalizeAccountsProviders } from "./helpers.js";
import { register_accounts_routes } from "./routes.js";
import {
  accountsLoginStates,
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  userProfiles,
} from "./schema.js";
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
  readonly schema = {
    profile: userProfiles,
    login_states: accountsLoginStates,
    auth_users: authUsers,
    auth_sessions: authSessions,
    auth_accounts: authAccounts,
    auth_verifications: authVerifications,
  };

  /** 已归一化的登录 Provider。 */
  private readonly providers: AccountsProvider[];
  /** 安装后创建、生命周期跟随 Service 的登录运行时。 */
  private runtime?: AccountsRuntime;

  constructor(private readonly options: AccountsServiceOptions = {}) {
    const providers = normalizeAccountsProviders(options.providers ?? []);
    super(mergeAccountsEnvRequirements([
      ...accounts_env,
      ...providers.flatMap((provider) => provider.env),
    ]));
    this.providers = providers;
    this.instruction = ({ actions }) => [
      "提供 Downcity 的统一账号服务容器，具体登录方式由 email / phone / OAuth 等 provider 决定。",
      "provider 满足 required env 或 runtime 配置后，才会出现在 /providers 中供客户端使用。",
      "登录开始时传入 bureau_id，认证成功后通过 login/result 读取绑定该 Bureau 的 user_token。",
      "OAuth 回调地址固定为 /v1/accounts/oauth/callback，服务会根据 Federation 公网地址生成完整回调 URL。",
      `当前暴露 ${actions.length} 个动作，常用流程由 /providers 返回的 provider 决定。`,
    ].join("\n");
  }

  /** 创建登录运行时并注册 Accounts 路由。 */
  install(ctx: ServiceInstallContext): void {
    this.runtime = new AccountsRuntime({
      service_options: this.options,
      providers: this.providers,
      database: ctx.database,
      install_context: ctx,
      read_env: (key) => this._env?.get(key),
      read_base_url: () => this._baseURL,
      require_active_bureau: (bureau_id) => this.require_active_bureau(bureau_id),
    });
    register_accounts_routes(this.runtime, ctx);
  }

  /** 初始化 better-auth 运行时。 */
  protected override async on_init(): Promise<void> {
    this.require_runtime().initialize();
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

  /** 确认 Bureau 存在且当前可用于登录与 Token 签发。 */
  private async require_active_bureau(bureau_id: string): Promise<void> {
    if (!bureau_id) throw httpError(400, "bureau_id required");
    const bureau = await this._bureauStore?.get(bureau_id);
    if (!bureau) throw httpError(404, `Unknown Bureau: ${bureau_id}`);
    if (bureau.state !== "active") {
      throw httpError(403, `Bureau is not active: ${bureau_id}`);
    }
  }

  /** 读取已经完成安装的 Accounts 登录运行时。 */
  private require_runtime(): AccountsRuntime {
    if (!this.runtime) throw new Error("Accounts service runtime is not installed");
    return this.runtime;
  }
}
