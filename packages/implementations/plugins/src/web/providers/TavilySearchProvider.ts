/** Tavily Web Search Provider。 */

import type { WebSearchInput, WebSearchProvider, WebSearchResult } from "@/web/types/WebPlugin.js";
import type { TavilySearchProviderOptions } from "@/web/types/WebProviderOptions.js";
import { safe_fetch } from "@/web/providers/WebHttp.js";

/** Tavily `/search` 返回结构的最小读取视图。 */
interface TavilyResponse {
  /** Tavily 搜索结果。 */
  results?: Array<{
    /** 页面 URL。 */ url?: unknown;
    /** 页面标题。 */ title?: unknown;
    /** 页面摘要。 */ content?: unknown;
    /** 相关性分数。 */ score?: unknown;
  }>;
}

/** 使用 Tavily Search API 的搜索 Provider。 */
export class TavilySearchProvider implements WebSearchProvider {
  readonly name = "tavily";

  constructor(private readonly options: TavilySearchProviderOptions) {
    if (!options.api_key.trim()) throw new TypeError("TavilySearchProvider requires api_key");
  }

  async search(input: WebSearchInput): Promise<WebSearchResult> {
    const response = await safe_fetch("https://api.tavily.com/search", {
      method: "POST",
      trusted_endpoint: true,
      timeout_ms: this.options.timeout_ms,
      max_response_bytes: this.options.max_response_bytes,
      headers: {
        authorization: `Bearer ${this.options.api_key.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: input.query,
        max_results: Math.min(20, Math.max(1, input.limit ?? 10)),
        ...(input.domains?.length ? { include_domains: input.domains } : {}),
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Tavily search failed with HTTP ${response.status}`);
    }
    const payload = parse_json<TavilyResponse>(response.text, "Tavily");
    return {
      provider: this.name,
      items: (payload.results ?? []).flatMap((item) => {
        if (typeof item.url !== "string") return [];
        return [{
          url: item.url,
          title: typeof item.title === "string" ? item.title : null,
          snippet: typeof item.content === "string" ? item.content : null,
          score: typeof item.score === "number" ? item.score : null,
        }];
      }),
    };
  }
}

/** 解析 Provider JSON，避免把响应正文带入错误。 */
function parse_json<TValue>(text: string, provider: string): TValue {
  try {
    return JSON.parse(text) as TValue;
  } catch {
    throw new Error(`${provider} returned invalid JSON`);
  }
}
