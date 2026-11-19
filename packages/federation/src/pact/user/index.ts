/**
 * 终端用户请求层：统一识别静态与动态凭证，并在 JSON 和流请求发送前解析认证。
 * 动态读取器失败时终止请求，不回退旧凭证或重放业务请求；刷新凭证退出独立认证。
 */

import { AIInvoker, serialize_model } from "../invoker/ai/index.js";
import { PaymentInvoker } from "../invoker/payment/index.js";
import { ServiceClient } from "../invoker/invoker.js";
import { UserInvoker } from "../invoker/user/index.js";
import type { FederationActionInput, UserPactAccessOptions, UserServiceSummary } from "./types.js";
import type { ServiceCatalogDetail } from "../../types/ServiceCatalog.js";
import {
  defaultFetch,
  requiredString,
  type RequestInitLike,
} from "../http.js";
import {
  create_http_requester,
  type CityRequester,
} from "../requester.js";

export class UserPactAccess {
  readonly ai: AIInvoker;
  readonly payment: PaymentInvoker;
  readonly user: UserInvoker;

  readonly serverUrl: string;
  readonly token: string | undefined;

  private readonly requester: CityRequester;
  /** 请求快照绑定的动态凭证来源，也独立构成用户身份。 */
  private readonly resolve_user_token?: () => Promise<string>;

  constructor(options: UserPactAccessOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("User City options are required");
    }

    this.serverUrl = requiredString(options.base_url, "base_url").replace(/\/+$/, "");
    this.token = readOptional(options.user_token);
    this.resolve_user_token = options.resolve_user_token;
    const fetcher = options.fetch ?? defaultFetch();
    this.requester = create_http_requester({
      base_url: this.serverUrl,
      fetch: async (url, init) => {
        // 退出用刷新凭证或当前静态凭证认证，不依赖一次额外续期。
        if (!this.resolve_user_token || url === `${this.serverUrl}/v1/accounts/logout`) return fetcher(url, init);
        const user_token = requiredString(await this.resolve_user_token(), "resolved user_token");
        return fetcher(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${user_token}` } });
      },
      with_auth: (init) => this.withAuth(init),
    });

    this.ai = new AIInvoker({
      baseUrl: this.serverUrl,
      requestJSON: (path, init) => this.json(path, init),
      requestRaw: (path, init) => this.raw(path, init),
      buildInput: (input) => this.buildInput(input),
    });
    this.payment = new PaymentInvoker({
      requestJSON: (path, init) => this.json(path, init),
      hasUserToken: () => this.has_user_credentials(),
    });
    this.user = new UserInvoker({
      requestJSON: (path, init) => this.json(path, init),
      hasUserToken: () => this.has_user_credentials(),
    });
  }

  // ===================================================================
  // Service → Action 调用
  // ===================================================================

  /** 获取 Service 调用器 */
  service(name: string): ServiceClient {
    const id = String(name ?? "").trim();
    if (!id) throw new TypeError("service name is required");
    return new ServiceClient(
      (path, init) => this.json(path, init),
      "/v1",
      id,
    );
  }

  /** 列出已注册的 service 摘要 */
  async listServices(): Promise<UserServiceSummary[]> {
    return this.json<{ items: UserServiceSummary[] }>("/v1/services", { method: "GET" })
      .then((body) => body.items);
  }

  /** 获取服务完整 instruction、入口文档及本地可用性。 */
  describe_service(service_id: string): Promise<ServiceCatalogDetail> {
    const id = requiredString(service_id, "service_id");
    return this.json(`/v1/services/${encodeURIComponent(id)}`, { method: "GET" });
  }

  /** 读取当前实例按注册元数据生成的 OpenAPI 3.1 文档。 */
  openapi(): Promise<Record<string, unknown>> {
    return this.json("/openapi.json", { method: "GET" });
  }

  // ===================================================================
  // 内部
  // ===================================================================

  private json<T>(path: string, init: RequestInitLike): Promise<T> {
    return this.requester.json<T>(path, init);
  }

  private raw(path: string, init: RequestInitLike) {
    this.requireToken();
    return this.requester.raw(path, init);
  }

  private withAuth(init: RequestInitLike): RequestInitLike {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...init.headers,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return { ...init, headers };
  }

  private buildInput(input: FederationActionInput): Record<string, unknown> {
    return {
      ...input,
      model: serialize_model(input.model),
    };
  }

  private has_user_credentials(): boolean {
    return Boolean(this.token || this.resolve_user_token);
  }

  private requireToken(): void {
    if (!this.has_user_credentials()) throw new TypeError("user_token is required for this operation");
  }
}

function readOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, "option");
}
