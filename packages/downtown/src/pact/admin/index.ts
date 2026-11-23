/**
 * Downtown 管理员控制面 HTTP 访问层。
 *
 * 只使用 Downtown 管理员 Session Token 调用全局管理接口。
 */

import { ServiceClient } from "../invoker/invoker.js";
import type { ServiceCatalogDetail } from "../../types/ServiceCatalog.js";
import { CreditsInvoker } from "../invoker/credits/index.js";
import { EnvInvoker } from "../invoker/env/index.js";
import {
  requiredString,
  type RequestInitLike,
} from "../http.js";
import {
  create_http_requester,
  type CityRequester,
} from "../requester.js";
import type {
  AdminPactAccessOptions,
  AdminModelRecord,
  AdminServiceSummary,
} from "./types.js";

export class AdminPactAccess {
  readonly credits: CreditsInvoker;
  readonly env: EnvInvoker;

  private readonly base_url: string;
  private readonly secret: string | undefined;
  private readonly requester: CityRequester;

  constructor(options: AdminPactAccessOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("AdminPactAccess options are required");
    }

    this.base_url = requiredString(options.base_url, "base_url").replace(/\/+$/, "");
    this.secret = requiredString(options.credential, "credential");
    this.requester = create_http_requester({
      base_url: this.base_url,
      fetch: options.fetch,
      with_auth: (init) => this.withAuth(init),
    });

    const req = <T>(path: string, init: RequestInitLike) => this.json<T>(path, init);
    this.credits = new CreditsInvoker(req);
    this.env = new EnvInvoker({ requestJSON: req });
  }

  /** 获取 Service 调用器（与 User City 共用同一路由） */
  service(name: string): ServiceClient {
    const id = String(name ?? "").trim();
    if (!id) throw new TypeError("service name is required");
    return new ServiceClient(
      (path, init) => this.json(path, init),
      "/v1",
      id,
      (path, init) => this.requester.raw(path, init),
    );
  }

  /** 列出当前 Downtown 暴露的 service 摘要。 */
  async listServices(): Promise<AdminServiceSummary[]> {
    const body = await this.json<{ items: AdminServiceSummary[] }>("/v1/services", {
      method: "GET",
    });
    return body.items;
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

  /** 列出当前 Downtown 注册的模型目录（admin 身份可见额外状态字段）。 */
  async listModels(): Promise<AdminModelRecord[]> {
    const body = await this.json<{ items: AdminModelRecord[] }>("/v1/ai/models", {
      method: "GET",
    });
    return body.items;
  }

  /** 读取 City 聚合后的说明文档。 */
  async instruction(): Promise<string> {
    return this.text("/v1/downtown/instruction", { method: "GET" });
  }

  private json<T>(path: string, init: RequestInitLike): Promise<T> {
    return this.requester.json<T>(path, init);
  }

  private text(path: string, init: RequestInitLike): Promise<string> {
    return this.requester.text(path, init);
  }
  /**
   * 为 Downtown 管理请求统一补齐鉴权头。
   *
   * 关键说明（中文）
   * - 所有控制面请求都必须带上管理凭证
   * - 默认仍然补 `content-type: application/json`，便于 POST action 统一行为
   */
  private withAuth(init: RequestInitLike): RequestInitLike {
    if (!this.secret) return init;
    return {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.secret}`,
        ...init.headers,
      },
    };
  }
}
