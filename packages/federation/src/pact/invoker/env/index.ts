/**
 * Env Service 调用器（对应 service/env/env-service.ts EnvService）。
 *
 * 管理端操作：list / upsert / remove / import。
 */

import type { RequestInitLike } from "../../http.js";
import type {
  EnvCatalogScope,
  EnvEntry,
  EnvRefreshResult,
  EnvUpsertInput,
} from "./types.js";

const PREFIX = "/v1/env";

/**
 * 环境变量管理调用器。
 *
 * 通过 Admin City .env 访问：
 * ```ts
 * await admin.env.list();
 * await admin.env.upsert({ key: "KEY", value: "val" });
 * ```
 */
export class EnvInvoker {
  private readonly req: <T>(path: string, init: RequestInitLike) => Promise<T>;

  constructor(opts: {
    requestJSON: <T>(path: string, init: RequestInitLike) => Promise<T>;
  }) {
    this.req = opts.requestJSON;
  }

  /** 列出环境变量 */
  async list(): Promise<EnvEntry[]> {
    const body = await this.req<{ items: EnvEntry[] }>(`${PREFIX}/list`, { method: "GET" });
    return body.items;
  }

  /** 读取 City 聚合后的 env requirement 目录 */
  async catalog(): Promise<EnvCatalogScope[]> {
    const body = await this.req<{ items: EnvCatalogScope[] }>(`${PREFIX}/catalog`, { method: "GET" });
    return body.items;
  }

  /** 写入/更新 */
  upsert(input: EnvUpsertInput): Promise<unknown> {
    return this.req(`${PREFIX}/upsert`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** 删除 */
  remove(key: string): Promise<unknown> {
    return this.req(`${PREFIX}/remove`, {
      method: "POST",
      body: JSON.stringify({ key }),
    });
  }

  /** 主动刷新当前 Federation runtime 的 env cache */
  refresh(): Promise<EnvRefreshResult> {
    return this.req<EnvRefreshResult>(`${PREFIX}/refresh`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  /** 批量导入 .env 文本 */
  import(raw: string): Promise<unknown> {
    return this.req(`${PREFIX}/import`, {
      method: "POST",
      body: JSON.stringify({ raw }),
    });
  }
}
