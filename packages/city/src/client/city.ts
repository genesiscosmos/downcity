/**
 * City 终端用户客户端。
 *
 * City 登录前只持有 Federation 地址；登录后由 Federation 验证 User Token，
 * 并解析当前 Bureau 及其唯一服务端入口。
 */

import { UserPactAccess } from "../pact/user/index.js";
import type { ServiceClient } from "../pact/invoker/invoker.js";
import type { CityOptions } from "./types.js";
import type { UserServiceSummary } from "../pact/user/types.js";
import { defaultFetch, requestJSON, type FetchLike, type RequestInitLike } from "../pact/http.js";
import type { BureauRecord } from "../types/Bureau.js";

/** Downcity City 用户客户端。 */
export class City {
  private readonly user_access: UserPactAccess;
  private readonly federation_url: string;
  private readonly user_token?: string;
  private readonly fetcher: FetchLike;
  private bureau_promise?: Promise<BureauRecord>;

  constructor(options: CityOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("City options are required");
    }
    this.federation_url = normalize_http_url(options.federation_url, "federation_url");
    this.user_access = new UserPactAccess({
      base_url: this.federation_url,
      user_token: options.user_token,
      fetch: options.fetch,
    });
    this.user_token = options.user_token;
    this.fetcher = options.fetch ?? defaultFetch();
  }

  /** 读取当前 User Token 经 Federation 验证后对应的 Bureau。 */
  async bureau(): Promise<BureauRecord> {
    if (!this.user_token) throw new TypeError("user_token is required to resolve the current Bureau");
    if (!this.bureau_promise) {
      this.bureau_promise = this.resolve_bureau().catch((error) => {
        this.bureau_promise = undefined;
        throw error;
      });
    }
    return await this.bureau_promise;
  }

  /** 用户侧 AI 调用入口。 */
  get ai(): UserPactAccess["ai"] {
    return this.user_access.ai;
  }

  /** 用户侧支付入口。 */
  get payment(): UserPactAccess["payment"] {
    return this.user_access.payment;
  }

  /** Federation 当前用户数据入口。 */
  user(): UserPactAccess["user"] {
    return this.user_access.user;
  }

  /** 获取普通 Service 调用器。 */
  service(name: string): ServiceClient {
    return this.user_access.service(name);
  }

  /** 列出 Federation 暴露的 Service。 */
  listServices(): Promise<UserServiceSummary[]> {
    return this.user_access.listServices();
  }

  /** 向当前产品预先配置的 Bureau 发送 JSON GET 请求。 */
  get<T = unknown>(path: string): Promise<T> {
    return this.request_bureau_json<T>(path, { method: "GET" });
  }

  /** 向当前产品预先配置的 Bureau 发送 JSON POST 请求。 */
  post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    return this.request_bureau_json<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async request_bureau_json<T>(path: string, init: RequestInitLike): Promise<T> {
    const bureau = await this.bureau();
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (this.user_token) headers.authorization = `Bearer ${this.user_token}`;
    return requestJSON<T>({
      fetch: this.fetcher,
      url: resolve_request_url(path, bureau.server.server_url),
      init: { ...init, headers },
    });
  }

  /** 由 Federation 权威解析 User Token 绑定的 Bureau。 */
  private async resolve_bureau(): Promise<BureauRecord> {
    const body = await requestJSON<{ bureau?: BureauRecord }>({
      fetch: this.fetcher,
      url: `${this.federation_url}/v1/bureaus/current`,
      init: {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.user_token}`,
        },
      },
    });
    if (!body.bureau?.bureau_id || !body.bureau.server?.server_url
      || body.bureau.server.bureau_id !== body.bureau.bureau_id
      || body.bureau.state !== "active") {
      throw new TypeError("Federation returned an invalid current Bureau");
    }
    return body.bureau;
  }
}

function read_required_string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
}

function normalize_http_url(value: unknown, field: string): string {
  const input = read_required_string(value, field).replace(/\/+$/, "");
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${field} must use http or https`);
  }
  if (url.username || url.password) throw new TypeError(`${field} must not contain credentials`);
  return input;
}

function resolve_request_url(value: string, base_url: string): string {
  const input = String(value ?? "").trim();
  if (!input) throw new TypeError("url is required");
  let base: URL;
  let resolved: URL;
  try {
    base = new URL(`${base_url.replace(/\/+$/u, "")}/`);
    resolved = new URL(input, base);
  } catch {
    throw new TypeError("url must be a valid URL");
  }
  if (resolved.origin !== base.origin) {
    throw new TypeError("url must use the current Bureau server origin");
  }
  return resolved.toString();
}
