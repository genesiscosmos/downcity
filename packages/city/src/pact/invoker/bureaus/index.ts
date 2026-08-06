/**
 * Federation Bureau 控制面调用器。
 *
 * 该调用器只供管理员客户端使用，Bureau 机器凭证不能调用这些接口。
 */

import type { RequestInitLike } from "../../http.js";
import type {
  BureauCreateInput,
  BureauRecord,
  BureauServerUpdateInput,
  BureauTokenSummary,
  RegisterBureauTokenInput,
} from "../../../types/Bureau.js";

const PREFIX = "/v1/bureaus";

/** Bureau Token 注册表调用器。 */
export class BureauTokensInvoker {
  constructor(
    private readonly req: <T>(path: string, init: RequestInitLike) => Promise<T>,
  ) {}

  /** 登记本地生成的 Bureau Token hash。 */
  register(input: RegisterBureauTokenInput): Promise<BureauTokenSummary> {
    return this.req(`${PREFIX}/tokens/register`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** 按 Bureau 列出 Token 元数据。 */
  async list(bureau_id?: string): Promise<BureauTokenSummary[]> {
    const query = bureau_id ? `?bureau_id=${encodeURIComponent(bureau_id)}` : "";
    const body = await this.req<{ items: BureauTokenSummary[] }>(
      `${PREFIX}/tokens/list${query}`,
      { method: "GET" },
    );
    return body.items;
  }

  /** 立即撤销指定 Bureau Token。 */
  revoke(token_id: string): Promise<{ success: true }> {
    return this.req(`${PREFIX}/tokens/revoke`, {
      method: "POST",
      body: JSON.stringify({ token_id }),
    });
  }
}

/** Bureau 唯一 Server 配置调用器。 */
export class BureauServerInvoker {
  constructor(
    private readonly req: <T>(path: string, init: RequestInitLike) => Promise<T>,
  ) {}

  /** 更新 Bureau 唯一 Server 的 HTTP(S) 入口。 */
  update(input: BureauServerUpdateInput): Promise<BureauRecord> {
    return this.req(`${PREFIX}/server/update`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
}

/** Federation Bureau 身份管理调用器。 */
export class BureausInvoker {
  /** Bureau 机器凭证注册表。 */
  readonly tokens: BureauTokensInvoker;
  /** Bureau 唯一 Server 配置。 */
  readonly server: BureauServerInvoker;

  constructor(options: {
    /** 发送带 Federation 管理员会话鉴权的 JSON 请求。 */
    requestJSON: <T>(path: string, init: RequestInitLike) => Promise<T>;
  }) {
    this.tokens = new BureauTokensInvoker(options.requestJSON);
    this.server = new BureauServerInvoker(options.requestJSON);
    this.req = options.requestJSON;
  }

  private readonly req: <T>(path: string, init: RequestInitLike) => Promise<T>;

  /** 列出全部 Bureau。 */
  async list(): Promise<BureauRecord[]> {
    const body = await this.req<{ items: BureauRecord[] }>(`${PREFIX}/list`, { method: "GET" });
    return body.items;
  }

  /** 创建稳定 Bureau 身份。 */
  create(input: BureauCreateInput): Promise<BureauRecord> {
    return this.req(`${PREFIX}/create`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** 暂停 Bureau。 */
  pause(bureau_id: string): Promise<BureauRecord> {
    return this.mutate("pause", bureau_id);
  }

  /** 恢复 Bureau。 */
  activate(bureau_id: string): Promise<BureauRecord> {
    return this.mutate("activate", bureau_id);
  }

  /** 归档 Bureau 并撤销它的机器凭证。 */
  archive(bureau_id: string): Promise<BureauRecord> {
    return this.mutate("archive", bureau_id);
  }

  private mutate(action: "pause" | "activate" | "archive", bureau_id: string): Promise<BureauRecord> {
    return this.req(`${PREFIX}/${action}`, {
      method: "POST",
      body: JSON.stringify({ bureau_id }),
    });
  }
}
