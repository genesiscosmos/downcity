/**
 * DeepSeek 自研搜索引擎的 Web 搜索 Provider。
 *
 * 将统一的结果数量与域名过滤转换为 Search API 请求；最终 query 按 Unicode 字符校验，
 * 不截断关键词或搜索语法。优先返回适合模型阅读的长摘要，保留 DeepSeek 原始排序分数。
 */

import { z } from "zod";
import type { WebSearchInput, WebSearchProvider, WebSearchResult } from "@/web/types/WebPower.js";
import type { DeepSeekProviderOptions } from "@/web/types/WebProviderOptions.js";
import { request_deepseek } from "@/web/providers/DeepSeekHttp.js";

/** 只读取统一搜索结果需要的字段；不向外泄漏服务端的其它字段。 */
const SEARCH_RESPONSE_SCHEMA = z.object({
  results: z.array(z.object({
    url: z.string(),
    title: z.string().nullish(),
    summary: z.string().nullish(),
    snippet: z.string().nullish(),
    rerank_score: z.number().nullish(),
  })),
});

/** 使用 DeepSeek `/v1/tools/search` 的搜索 Provider。 */
export class DeepSeekSearchProvider implements WebSearchProvider {
  /** 结果与诊断中的稳定 Provider 名称。 */
  readonly name = "deepseek";

  constructor(private readonly options: DeepSeekProviderOptions) {
    if (!options.api_key.trim()) throw new TypeError("DeepSeekSearchProvider requires api_key");
  }

  /** 搜索公开网页，保留无结果时的正常空数组语义。 */
  async search(input: WebSearchInput): Promise<WebSearchResult> {
    const query = build_query(input);
    const count = Number.isFinite(input.limit)
      ? Math.min(50, Math.max(1, Math.floor(input.limit ?? 10)))
      : 10;
    const payload = SEARCH_RESPONSE_SCHEMA.safeParse(await request_deepseek(
      "search",
      { query, count, need_content: false },
      this.options,
    ));
    if (!payload.success) throw new Error("DeepSeek search returned invalid results");
    return {
      provider: this.name,
      items: payload.data.results.map((item) => ({
        url: item.url,
        title: item.title ?? null,
        snippet: item.summary?.trim() ? item.summary : item.snippet ?? null,
        score: item.rerank_score ?? null,
      })),
    };
  }
}

/** 把域名限制加入官方搜索语法，并校验组合后的 128 个 Unicode 字符上限。 */
function build_query(input: WebSearchInput): string {
  let query = input.query.trim();
  if (!query) throw new TypeError("DeepSeek search query must not be blank");
  if (input.domains?.length) {
    const domains = [...new Set(input.domains.map((domain) => domain.trim()))];
    for (const domain of domains) {
      // 限定为域名，防止 domains 中的空格或操作符改变用户原有搜索含义。
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(domain)) {
        throw new TypeError("DeepSeek search domains must contain hostnames only (use punycode for international domains)");
      }
    }
    query += ` ${domains.map((domain) => `site:${domain}`).join(" OR ")}`;
  }
  if (Array.from(query).length > 128) {
    throw new TypeError("DeepSeek search query, including domain filters, must be at most 128 Unicode characters");
  }
  return query;
}
