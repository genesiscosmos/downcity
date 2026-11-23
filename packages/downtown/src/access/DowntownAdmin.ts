/**
 * Downtown 管理员身份子域。
 *
 * Admin Session 管理 Downtown 控制面，与用户身份隔离。
 */

import { AdminPactAccess } from "../pact/admin/index.js";
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
  DowntownAdminLoginRequest,
  DowntownAdminSession,
  DowntownCurrentAdmin,
} from "./types/DowntownAdmin.js";
import type { DowntownAdminOptions } from "./types/DowntownInternal.js";
import { DowntownRelayAdmin } from "./DowntownRelay.js";

/** Downtown 管理员身份子域。 */
export class DowntownAdmin {
  private readonly url: string;
  private readonly fetcher: FetchLike;
  private admin_token?: string;
  private admin_access?: AdminPactAccess;

  constructor(options: DowntownAdminOptions) {
    this.url = normalize_http_url(options.url);
    this.admin_token = read_optional_string(options.admin_token);
    this.fetcher = options.fetch ?? defaultFetch();
  }

  /** 模型中转目录、渠道部署和全局日志管理。 */
  get relay(): DowntownRelayAdmin {
    return new DowntownRelayAdmin(() => this.service("ai"));
  }

  /** Downtown Credits 管理入口。 */
  get credits(): CreditsInvoker {
    return this.require_admin_access().credits;
  }

  /** Downtown 环境变量管理入口。 */
  get env(): EnvInvoker {
    return this.require_admin_access().env;
  }

  /** 使用管理员 ID 和密码创建新的 Admin Session。 */
  async login(input: DowntownAdminLoginRequest): Promise<DowntownAdminSession> {
    const result = await requestJSON<DowntownAdminSession>({
      fetch: this.fetcher,
      url: this.url + "/v1/admin/login",
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
      throw new TypeError("Downtown returned an invalid admin session");
    }
    this.admin_token = result.session_token;
    this.admin_access = undefined;
    return result;
  }

  /** 读取当前管理员 Session。 */
  async current(): Promise<DowntownCurrentAdmin> {
    const admin_token = this.require_admin_token();
    return await requestJSON<DowntownCurrentAdmin>({
      fetch: this.fetcher,
      url: this.url + "/v1/admin/session",
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
      url: this.url + "/v1/admin/logout",
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
  }

  /** 读取当前 Downtown 实例中的 Admin Session Token。 */
  token(): string | undefined {
    return this.admin_token;
  }

  /** 获取 Downtown 管理 Service 调用器。 */
  service(name: string): ServiceClient {
    return this.require_admin_access().service(name);
  }

  /** 列出 Downtown 当前注册的 Service。 */
  list_services(): Promise<AdminServiceSummary[]> {
    return this.require_admin_access().listServices();
  }

  /** 读取单个服务的完整公开说明与入口文档。 */
  describe_service(service_id: string): ReturnType<AdminPactAccess["describe_service"]> {
    return this.require_admin_access().describe_service(service_id);
  }

  /** 读取当前实例生成的 OpenAPI 3.1 文档。 */
  openapi(): Promise<Record<string, unknown>> {
    return this.require_admin_access().openapi();
  }

  /** 列出 Downtown 当前注册的 AI 模型。 */
  list_models(): Promise<AdminModelRecord[]> {
    return this.require_admin_access().listModels();
  }

  /** 读取 Downtown 聚合说明。 */
  instruction(): Promise<string> {
    return this.require_admin_access().instruction();
  }

  /** 释放当前实例保存的管理员身份与访问器缓存。 */
  clear_credentials(): void {
    this.admin_token = undefined;
    this.admin_access = undefined;
  }

  private require_admin_token(): string {
    if (!this.admin_token) {
      throw new TypeError("admin_token is required for this operation");
    }
    return this.admin_token;
  }

  private require_admin_access(): AdminPactAccess {
    if (!this.admin_access) {
      this.admin_access = new AdminPactAccess({
        base_url: this.url,
        credential: this.require_admin_token(),
        fetch: this.fetcher,
      });
    }
    return this.admin_access;
  }

}

function normalize_http_url(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("url is required");
  }
  const input = value.trim().replace(/\/+$/u, "");
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("url must use http or https");
  }
  if (url.username || url.password) {
    throw new TypeError("url must not contain credentials");
  }
  return input;
}

function read_optional_string(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}
