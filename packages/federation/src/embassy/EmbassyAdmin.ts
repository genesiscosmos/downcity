/**
 * Embassy 管理员身份子域。
 *
 * Admin Session 管理 Federation 控制面。Bureau 机器身份由独立 Bureau 对象持有，
 * 不进入 Embassy 管理员身份的生命周期。
 */

import { FederationAdmin } from "../pact/admin/index.js";
import type { ServiceClient } from "../pact/invoker/invoker.js";
import type { CreditsInvoker } from "../pact/invoker/credits/index.js";
import type { EnvInvoker } from "../pact/invoker/env/index.js";
import type {
  AdminModelRecord,
  AdminServiceSummary,
} from "../pact/admin/types.js";
import {
  defaultFetch,
  requestJSON,
  type FetchLike,
} from "../pact/http.js";
import type {
  EmbassyAdminLoginInput,
  EmbassyAdminSession,
  EmbassyCurrentAdmin,
} from "./types/EmbassyAdmin.js";
import type { EmbassyAdminOptions } from "./types/EmbassyInternal.js";
import { EmbassyBureaus } from "./EmbassyBureaus.js";

/** Embassy 管理员身份子域。 */
export class EmbassyAdmin {
  private readonly federation_url: string;
  private readonly fetcher: FetchLike;
  private admin_token?: string;
  private admin_access?: FederationAdmin;
  private bureau_management?: EmbassyBureaus;

  constructor(options: EmbassyAdminOptions) {
    this.federation_url = normalize_http_url(options.federation_url);
    this.admin_token = read_optional_string(options.admin_token);
    this.fetcher = options.fetch ?? defaultFetch();
  }

  /** Federation Credits 管理入口。 */
  get credits(): CreditsInvoker {
    return this.require_admin_access().credits;
  }

  /** Federation Bureau 管理入口。 */
  get bureaus(): EmbassyBureaus {
    if (!this.bureau_management) {
      this.bureau_management = new EmbassyBureaus(this.require_admin_access().bureaus);
    }
    return this.bureau_management;
  }

  /** Federation 环境变量管理入口。 */
  get env(): EnvInvoker {
    return this.require_admin_access().env;
  }

  /** 使用管理员 ID 和密码创建新的 Admin Session。 */
  async login(input: EmbassyAdminLoginInput): Promise<EmbassyAdminSession> {
    const result = await requestJSON<EmbassyAdminSession>({
      fetch: this.fetcher,
      url: this.federation_url + "/v1/admin/login",
      init: {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      },
    });
    if (!result.admin_id || !result.session_token || !result.expires_at) {
      throw new TypeError("Federation returned an invalid admin session");
    }
    this.admin_token = result.session_token;
    this.admin_access = undefined;
    this.bureau_management = undefined;
    return result;
  }

  /** 读取当前管理员 Session。 */
  async current(): Promise<EmbassyCurrentAdmin> {
    const admin_token = this.require_admin_token();
    return await requestJSON<EmbassyCurrentAdmin>({
      fetch: this.fetcher,
      url: this.federation_url + "/v1/admin/session",
      init: {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer " + admin_token,
        },
      },
    });
  }

  /** 撤销当前管理员 Session 并清理当前实例。 */
  async logout(): Promise<void> {
    const admin_token = this.require_admin_token();
    await requestJSON<{ ok: true }>({
      fetch: this.fetcher,
      url: this.federation_url + "/v1/admin/logout",
      init: {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: "Bearer " + admin_token,
        },
      },
    });
    this.admin_token = undefined;
    this.admin_access = undefined;
    this.bureau_management = undefined;
  }

  /** 读取当前 Embassy 实例中的 Admin Session Token。 */
  token(): string | undefined {
    return this.admin_token;
  }

  /** 获取 Federation 管理 Service 调用器。 */
  service(name: string): ServiceClient {
    return this.require_admin_access().service(name);
  }

  /** 列出 Federation 当前注册的 Service。 */
  list_services(): Promise<AdminServiceSummary[]> {
    return this.require_admin_access().listServices();
  }

  /** 列出 Federation 当前注册的 AI 模型。 */
  list_models(): Promise<AdminModelRecord[]> {
    return this.require_admin_access().listModels();
  }

  /** 读取 Federation 聚合说明。 */
  instruction(): Promise<string> {
    return this.require_admin_access().instruction();
  }

  private require_admin_token(): string {
    if (!this.admin_token) {
      throw new TypeError("admin_token is required for this operation");
    }
    return this.admin_token;
  }

  private require_admin_access(): FederationAdmin {
    if (!this.admin_access) {
      this.admin_access = new FederationAdmin({
        base_url: this.federation_url,
        credential: this.require_admin_token(),
        fetch: this.fetcher,
      });
    }
    return this.admin_access;
  }

}

function normalize_http_url(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("federation_url is required");
  }
  const input = value.trim().replace(/\/+$/u, "");
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("federation_url must use http or https");
  }
  if (url.username || url.password) {
    throw new TypeError("federation_url must not contain credentials");
  }
  return input;
}

function read_optional_string(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}
