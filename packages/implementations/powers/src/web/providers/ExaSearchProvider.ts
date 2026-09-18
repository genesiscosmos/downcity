/** Exa Web Search Provider。 */

import type { WebSearchInput, WebSearchProvider, WebSearchResult } from "@/web/types/WebPower.js";
import type { ExaSearchProviderOptions } from "@/web/types/WebProviderOptions.js";
import { safe_fetch } from "@/web/providers/WebHttp.js";

/** Exa `/search` 返回结构的最小读取视图。 */
interface ExaResponse {
  /** Exa 搜索结果。 */
  results?: Array<{
    /** 页面 URL。 */ url?: unknown;
    /** 页面标题。 */ title?: unknown;
    /** 页面正文摘要。 */ text?: unknown;
    /** 相关性分数。 */ score?: unknown;
  }>;
}

/** 使用 Exa Search API 的搜索 Provider。 */
export class ExaSearchProvider implements WebSearchProvider {
  readonly name = "exa";

  constructor(private readonly options: ExaSearchProviderOptions) {
    if (!options.api_key.trim()) throw new TypeError("ExaSearchProvider requires api_key");
  }

  async search(input: WebSearchInput): Promise<WebSearchResult> {
    const response = await safe_fetch("https://api.exa.ai/search", {
      method: "POST",
      trusted_endpoint: true,
      timeout_ms: this.options.timeout_ms,
      max_response_bytes: this.options.max_response_bytes,
      headers: {
        "x-api-key": this.options.api_key.trim(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: input.query,
        numResults: Math.min(20, Math.max(1, input.limit ?? 10)),
        ...(input.domains?.length ? { includeDomains: input.domains } : {}),
        contents: { text: { maxCharacters: 2_000 } },
      }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Exa search failed with HTTP ${response.status}`);
    }
    const payload = parse_json<ExaResponse>(response.text);
    return {
      provider: this.name,
      items: (payload.results ?? []).flatMap((item) => {
        if (typeof item.url !== "string") return [];
        return [{
          url: item.url,
          title: typeof item.title === "string" ? item.title : null,
          snippet: typeof item.text === "string" ? item.text : null,
          score: typeof item.score === "number" ? item.score : null,
        }];
      }),
    };
  }
}

/** 解析 Exa JSON，避免把响应正文带入错误。 */
function parse_json<TValue>(text: string): TValue {
  try {
    return JSON.parse(text) as TValue;
  } catch {
    throw new Error("Exa returned invalid JSON");
  }
}
