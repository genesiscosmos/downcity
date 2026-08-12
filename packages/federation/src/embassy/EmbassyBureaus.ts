/**
 * Embassy Bureau 管理域。
 *
 * tokens 管理长期 Bureau 机器凭证，route 管理产品业务服务入口。
 */

import type { BureausInvoker } from "../pact/invoker/bureaus/index.js";
import type {
  BureauCreateInput,
  BureauRecord,
  BureauServerUpdateInput,
  BureauTokenIssueResult,
  BureauTokenSummary,
  IssueBureauTokenInput,
} from "../types/Bureau.js";

/** Bureau Token 注册表访问器。 */
export class EmbassyBureauTokens {
  constructor(private readonly bureaus: BureausInvoker) {}

  /** 由 Federation 签发 Bureau Token；明文只在本次响应返回。 */
  issue(input: IssueBureauTokenInput): Promise<BureauTokenIssueResult> {
    return this.bureaus.tokens.issue(input);
  }

  /** 列出 Bureau Token 元数据。 */
  list(bureau_id?: string): Promise<BureauTokenSummary[]> {
    return this.bureaus.tokens.list(bureau_id);
  }

  /** 立即撤销指定 Bureau Token。 */
  revoke(token_id: string): Promise<{ success: true }> {
    return this.bureaus.tokens.revoke(token_id);
  }
}

/** Bureau 可信业务路由访问器。 */
export class EmbassyBureauRoute {
  constructor(private readonly bureaus: BureausInvoker) {}

  /** 更新 Bureau 的可信业务服务入口。 */
  update(input: BureauServerUpdateInput): Promise<BureauRecord> {
    return this.bureaus.server.update(input);
  }
}

/** Embassy 管理员的 Bureau 管理域。 */
export class EmbassyBureaus {
  /** Bureau Token 注册表。 */
  readonly tokens: EmbassyBureauTokens;

  /** Bureau 可信业务服务路由。 */
  readonly route: EmbassyBureauRoute;

  constructor(private readonly bureaus: BureausInvoker) {
    this.tokens = new EmbassyBureauTokens(bureaus);
    this.route = new EmbassyBureauRoute(bureaus);
  }

  /** 列出全部 Bureau。 */
  list(): Promise<BureauRecord[]> {
    return this.bureaus.list();
  }

  /** 创建 Bureau。 */
  create(input: BureauCreateInput): Promise<BureauRecord> {
    return this.bureaus.create(input);
  }

  /** 暂停 Bureau。 */
  pause(bureau_id: string): Promise<BureauRecord> {
    return this.bureaus.pause(bureau_id);
  }

  /** 恢复 Bureau。 */
  activate(bureau_id: string): Promise<BureauRecord> {
    return this.bureaus.activate(bureau_id);
  }

  /** 归档 Bureau。 */
  archive(bureau_id: string): Promise<BureauRecord> {
    return this.bureaus.archive(bureau_id);
  }
}
