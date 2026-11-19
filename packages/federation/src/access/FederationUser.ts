/**
 * Federation 用户身份子域。
 *
 * 用户业务统一通过当前 Federation 的 Service 调用。
 * 每个 City 可借用不可变来源视图，共享用户凭据但不共享可变来源状态。
 */

import { UserPactAccess } from "../pact/user/index.js";
import type { ServiceClient } from "../pact/invoker/invoker.js";
import type { UserServiceSummary } from "../pact/user/types.js";
import type { ServiceCatalogDetail } from "../types/ServiceCatalog.js";
import {
  defaultFetch,
  type FetchLike,
} from "../pact/http.js";
import { normalize_city_source } from "./city-source.js";
import { FederationAccount } from "./FederationAccount.js";
import { FederationRelay } from "./FederationRelay.js";
import type { FederationAccountLoginOptions, FederationAccountLoginResult } from "./types/FederationAccount.js";
import type { FederationUserOptions } from "./types/FederationInternal.js";
import type { FederationCurrentUser } from "./types/FederationUser.js";

/** Federation 用户身份子域。 */
export class FederationUser {
  /** Federation Accounts Service 访问器。 */
  readonly account: FederationAccount;

  private readonly url: string;
  private readonly fetcher: FetchLike;
  private readonly city_id?: string;
  private credentials: {
    /** 仅保存用户认证凭据；来源视图共享此凭据事实源。 */
    user_token?: string;
    /** 同一会话的动态凭证读取器，来源视图共用。 */
    resolve_user_token?: (fetcher: FetchLike) => Promise<string>;
  };
  /** 每次访问创建凭据快照，已经创建的请求不受后续账户切换影响。 */
  private get user_access(): UserPactAccess { return this.create_user_access(); }

  constructor(options: FederationUserOptions) {
    this.url = normalize_http_url(options.url, "url");
    this.credentials = { user_token: read_optional_string(options.user_token), resolve_user_token: options.resolve_user_token };
    this.fetcher = options.fetch ?? defaultFetch();
    this.city_id = normalize_city_source(options.city_id);
    this.account = new FederationAccount({
      accounts: () => this.service("accounts"),
      read_user_token: () => this.credentials.user_token,
      update_user_token: (user_token) => this.set_token(user_token),
    });
  }

  /** 登录用户的 API Key 管理与中转调用日志。 */
  get relay(): FederationRelay {
    return new FederationRelay(() => this.service("ai"));
  }

  /** 用户侧 AI 调用入口。 */
  get ai(): UserPactAccess["ai"] {
    return this.user_access.ai;
  }

  /** 用户侧支付入口。 */
  get payment(): UserPactAccess["payment"] {
    return this.user_access.payment;
  }

  /** 获取 Federation 普通 Service 调用器。 */
  service(name: string): ServiceClient {
    return this.user_access.service(name);
  }

  /** 列出 Federation 当前公开的 Service。 */
  list_services(): Promise<UserServiceSummary[]> {
    return this.user_access.listServices();
  }

  /** 读取单个服务的完整公开说明与入口文档。 */
  describe_service(service_id: string): Promise<ServiceCatalogDetail> {
    return this.user_access.describe_service(service_id);
  }

  /** 读取当前实例生成的 OpenAPI 3.1 文档。 */
  openapi(): Promise<Record<string, unknown>> {
    return this.user_access.openapi();
  }

  /** 执行一次账户登录编排。 */
  login(options: FederationAccountLoginOptions): Promise<FederationAccountLoginResult> {
    return this.account.login(options);
  }

  /** 读取当前 Token 对应的 Federation 用户和 Profile。 */
  async current(): Promise<FederationCurrentUser> {
    this.require_user_token();
    const result = await this.service("accounts").get<Partial<FederationCurrentUser>>("me");
    if (!result.user?.user_id) {
      throw new TypeError("Federation returned an invalid current user");
    }
    return {
      user: result.user,
      profile: result.profile ?? null,
    };
  }

  /** 借用当前用户的 City 来源视图；不注册 City、不增加权限，也不改变其他视图。 */
  with_city(city_id: string): FederationUser {
    const source = normalize_city_source(city_id)!;
    const scoped = new FederationUser({
      url: this.url,
      fetch: this.fetcher,
      city_id: source,
    });
    scoped.credentials = this.credentials;
    return scoped;
  }

  /** 释放当前实例及其来源视图共享的用户身份。 */
  clear_credentials(): void { this.set_token(undefined); }

  /** 更新后续请求使用的 Token，已创建的请求保留原身份快照。 */
  set_token(user_token: string | undefined): void {
    this.credentials.user_token = read_optional_string(user_token);
    this.credentials.resolve_user_token = undefined;
  }

  /** 绑定宿主持有的会话，后续所有用户请求在发送前获取最新凭证。 */
  set_token_resolver(resolve_user_token: (fetcher: FetchLike) => Promise<string>): void {
    this.credentials.resolve_user_token = resolve_user_token;
  }

  private create_user_access(): UserPactAccess {
    const credentials = { ...this.credentials };
    const resolve_user_token = credentials.resolve_user_token;
    return new UserPactAccess({
      base_url: this.url,
      user_token: credentials.user_token,
      resolve_user_token: resolve_user_token ? async () => {
        const user_token = read_optional_string(await resolve_user_token(this.fetcher));
        if (!user_token) throw new TypeError("resolved user_token is required for this operation");
        if (this.credentials.resolve_user_token === credentials.resolve_user_token
          && this.credentials.user_token === credentials.user_token) this.credentials.user_token = user_token;
        return user_token;
      } : undefined,
      fetch: async (url, init) => {
        const headers = { ...init.headers };
        if (this.city_id) headers["x-downcity-city-id"] = this.city_id;
        return this.fetcher(url, { ...init, headers });
      },
    });
  }

  private require_user_token(): void {
    if (!this.credentials.user_token && !this.credentials.resolve_user_token) {
      throw new TypeError("user_token is required for this operation");
    }
  }
}

function normalize_http_url(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(field + " is required");
  }
  const input = value.trim().replace(/\/+$/u, "");
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(field + " must use http or https");
  }
  if (url.username || url.password) {
    throw new TypeError(field + " must not contain credentials");
  }
  return input;
}

function read_optional_string(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}
