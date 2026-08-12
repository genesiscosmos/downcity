/**
 * Embassy 用户身份子域。
 *
 * 用户全局 Service 与 Bureau 业务路由共用当前 User Token，但分别发送到
 * Federation origin 和 Federation 发布的可信 Bureau origin。
 */

import { UserPactAccess } from "../pact/user/index.js";
import type { ServiceClient } from "../pact/invoker/invoker.js";
import type { UserServiceSummary } from "../pact/user/types.js";
import {
  defaultFetch,
  requestJSON,
  type FetchLike,
  type RequestInitLike,
} from "../pact/http.js";
import type { BureauRecord } from "../types/Bureau.js";
import { EmbassyAccount } from "./EmbassyAccount.js";
import type { EmbassyAccountLoginOptions, EmbassyAccountLoginResult } from "./types/EmbassyAccount.js";
import type { EmbassyUserOptions } from "./types/EmbassyInternal.js";
import type { EmbassyCurrentUser } from "./types/EmbassyUser.js";

/** Embassy 用户身份子域。 */
export class EmbassyUser {
  /** Federation Accounts Service 访问器。 */
  readonly account: EmbassyAccount;

  private readonly federation_url: string;
  private readonly fetcher: FetchLike;
  private user_token?: string;
  private user_access: UserPactAccess;
  private bureau_promise?: Promise<BureauRecord>;

  constructor(options: EmbassyUserOptions) {
    this.federation_url = normalize_http_url(options.federation_url, "federation_url");
    this.user_token = read_optional_string(options.user_token);
    this.fetcher = options.fetch ?? defaultFetch();
    this.user_access = this.create_user_access();
    this.account = new EmbassyAccount({
      accounts: () => this.service("accounts"),
      read_user_token: () => this.user_token,
      update_user_token: (user_token) => this.update_user_token(user_token),
    });
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

  /** 执行一次账户登录编排。 */
  login(options: EmbassyAccountLoginOptions): Promise<EmbassyAccountLoginResult> {
    return this.account.login(options);
  }

  /** 读取当前 Token 对应的 Federation 用户和 Profile。 */
  async current(): Promise<EmbassyCurrentUser> {
    this.require_user_token();
    const result = await this.service("accounts").get<Partial<EmbassyCurrentUser>>("me");
    if (!result.user?.user_id || !result.user.bureau_id) {
      throw new TypeError("Federation returned an invalid current user");
    }
    return {
      user: result.user,
      profile: result.profile ?? null,
    };
  }

  /** 向当前 Bureau 的可信业务入口发送 JSON GET 请求。 */
  get<T = unknown>(path: string): Promise<T> {
    return this.request_bureau_json<T>(path, { method: "GET" });
  }

  /** 向当前 Bureau 的可信业务入口发送 JSON POST 请求。 */
  post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.request_bureau_json<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private update_user_token(user_token: string | undefined): void {
    this.user_token = read_optional_string(user_token);
    this.user_access = this.create_user_access();
    this.bureau_promise = undefined;
  }

  private create_user_access(): UserPactAccess {
    return new UserPactAccess({
      base_url: this.federation_url,
      user_token: this.user_token,
      fetch: this.fetcher,
    });
  }

  private async request_bureau_json<T>(
    path: string,
    init: RequestInitLike,
  ): Promise<T> {
    const bureau = await this.resolve_bureau();
    const user_token = this.require_user_token();
    return await requestJSON<T>({
      fetch: this.fetcher,
      url: resolve_request_url(path, bureau.server.server_url),
      init: {
        ...init,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: "Bearer " + user_token,
        },
      },
    });
  }

  private async resolve_bureau(): Promise<BureauRecord> {
    if (!this.bureau_promise) {
      this.bureau_promise = this.read_current_bureau().catch((error) => {
        this.bureau_promise = undefined;
        throw error;
      });
    }
    return await this.bureau_promise;
  }

  private async read_current_bureau(): Promise<BureauRecord> {
    const user_token = this.require_user_token();
    const body = await requestJSON<{ bureau?: BureauRecord }>({
      fetch: this.fetcher,
      url: this.federation_url + "/v1/bureaus/current",
      init: {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer " + user_token,
        },
      },
    });
    const bureau = body.bureau;
    if (!bureau?.bureau_id || !bureau.server?.server_url
      || bureau.server.bureau_id !== bureau.bureau_id
      || bureau.state !== "active") {
      throw new TypeError("Federation returned an invalid current Bureau");
    }
    return bureau;
  }

  private require_user_token(): string {
    if (!this.user_token) {
      throw new TypeError("user_token is required for this operation");
    }
    return this.user_token;
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

function resolve_request_url(value: string, base_url: string): string {
  const input = String(value ?? "").trim();
  if (!input) throw new TypeError("url is required");
  const base = new URL(base_url.replace(/\/+$/u, "") + "/");
  const resolved = new URL(input, base);
  if (resolved.origin !== base.origin) {
    throw new TypeError("url must use the current Bureau server origin");
  }
  return resolved.toString();
}
