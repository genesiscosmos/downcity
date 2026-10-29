/**
 * Downcity 官方 Accounts 服务。
 *
 * AccountsService 是 Federation 集成边界：声明 Schema 与环境需求，创建登录
 * 运行时并注册路由。数据库准备、定期维护和实例认证初始化使用独立生命周期，
 * Provider 选择、认证流程和持久化分别由内部模块负责。
 */

import { httpError, InstallableService } from "@downcity/federation";
import type { EnvRequirement, ServiceInstallContext } from "@downcity/federation";
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
      "登录开始时传入 bureau_id 和 client_type，保存 login_secret；POST login/result 只查状态，完成后 POST login/exchange 一次性交换 Token。CLI/Desktop 必须展示 user_code 并在浏览器确认授权。",
      "OAuth 回调地址固定为 /v1/accounts/oauth/callback，服务会根据 Federation 公网地址生成完整回调 URL。",
      `当前暴露 ${actions.length} 个动作，常用流程由 /providers 返回的 provider 决定。`,
    ].join("\n");
  }

  /** 保存安装上下文并注册 Accounts 路由，复用已创建的登录运行时。 */
  install(ctx: ServiceInstallContext): void {
    this.install_context = ctx;
    register_accounts_routes(this.require_runtime(), ctx);
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
      require_active_bureau: (bureau_id) => this.require_active_bureau(bureau_id),
    });
    return this.runtime;
  }
}
