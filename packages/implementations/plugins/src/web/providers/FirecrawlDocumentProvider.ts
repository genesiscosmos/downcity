/** Firecrawl 网页正文 Provider。 */

import type { WebDocumentProvider, WebOpenInput, WebOpenResult } from "@/web/types/WebPlugin.js";
import type { FirecrawlDocumentProviderOptions } from "@/web/types/WebProviderOptions.js";
import { safe_fetch } from "@/web/providers/WebHttp.js";

/** Firecrawl scrape 返回结构的最小读取视图。 */
interface FirecrawlResponse {
  /** 请求是否成功。 */
  success?: unknown;
  /** 抓取结果。 */
  data?: {
    /** Markdown 正文。 */ markdown?: unknown;
    /** 页面 metadata。 */ metadata?: {
      /** 页面标题。 */ title?: unknown;
      /** 最终来源 URL。 */ sourceURL?: unknown;
      /** 兼容部分版本的来源 URL 字段。 */ url?: unknown;
    };
  };
}

/** 使用 Firecrawl `/v2/scrape` 的文档 Provider。 */
export class FirecrawlDocumentProvider implements WebDocumentProvider {
  readonly name = "firecrawl";

  constructor(private readonly options: FirecrawlDocumentProviderOptions) {
    if (!options.api_key.trim()) throw new TypeError("FirecrawlDocumentProvider requires api_key");
  }

  async open(input: WebOpenInput): Promise<WebOpenResult> {
    const response = await safe_fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      trusted_endpoint: true,
      timeout_ms: this.options.timeout_ms,
      max_response_bytes: this.options.max_response_bytes,
      headers: {
        authorization: `Bearer ${this.options.api_key.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: input.url, formats: ["markdown"] }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Firecrawl document request failed with HTTP ${response.status}`);
    }
    const payload = parse_json<FirecrawlResponse>(response.text);
    const markdown = payload.data?.markdown;
    if (payload.success !== true || typeof markdown !== "string") {
      throw new Error("Firecrawl returned no document content");
    }
    const metadata = payload.data?.metadata;
    const final_url = typeof metadata?.sourceURL === "string"
      ? metadata.sourceURL
      : typeof metadata?.url === "string" ? metadata.url : input.url;
    const max_chars = normalize_max_chars(input.max_chars);
    return {
      provider: this.name,
      url: final_url,
      title: typeof metadata?.title === "string" ? metadata.title : null,
      content: markdown.slice(0, max_chars),
    };
  }
}

/** 解析 Firecrawl JSON，避免把响应正文带入错误。 */
function parse_json<TValue>(text: string): TValue {
  try {
    return JSON.parse(text) as TValue;
  } catch {
    throw new Error("Firecrawl returned invalid JSON");
  }
}

/** 归一化正文字符限制。 */
function normalize_max_chars(value: number | undefined): number {
  if (!Number.isFinite(value)) return 40_000;
  return Math.min(100_000, Math.max(1, Math.floor(value ?? 40_000)));
}
