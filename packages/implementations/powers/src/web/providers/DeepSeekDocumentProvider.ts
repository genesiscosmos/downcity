/**
 * DeepSeek Fetch 的网页正文 Provider。
 *
 * 由 DeepSeek 抓取 HTTP(S) 页面并返回 Markdown，沿用 WebOpen 的标题与正文协议。
 * 输入地址遵循官方长度、协议和无凭据约束；输出遵循 Web 的正文字符上限。
 */

import { z } from "zod";
import type { WebDocumentProvider, WebOpenInput, WebOpenResult } from "@/web/types/WebPower.js";
import type { DeepSeekProviderOptions } from "@/web/types/WebProviderOptions.js";
import { request_deepseek } from "@/web/providers/DeepSeekHttp.js";

/** Fetch 的最小有效响应；空正文不能视为读取成功。 */
const FETCH_RESPONSE_SCHEMA = z.object({
  title: z.string(),
  content: z.string().refine((value) => value.trim().length > 0),
});

/** 使用 DeepSeek `/v1/tools/fetch` 的文档 Provider。 */
export class DeepSeekDocumentProvider implements WebDocumentProvider {
  /** 结果与诊断中的稳定 Provider 名称。 */
  readonly name = "deepseek";

  constructor(private readonly options: DeepSeekProviderOptions) {
    if (!options.api_key.trim()) throw new TypeError("DeepSeekDocumentProvider requires api_key");
  }

  /** 读取 Markdown；服务端未提供最终跳转地址，因此保留请求 URL。 */
  async open(input: WebOpenInput): Promise<WebOpenResult> {
    const url = new URL(input.url);
    if (Array.from(input.url).length > 8192
      || !["http:", "https:"].includes(url.protocol)
      || !url.hostname
      || url.username
      || url.password) {
      throw new TypeError("DeepSeek fetch requires an HTTP(S) URL without credentials, at most 8192 characters");
    }
    const payload = FETCH_RESPONSE_SCHEMA.safeParse(await request_deepseek(
      "fetch",
      { url: input.url },
      this.options,
    ));
    if (!payload.success) throw new Error("DeepSeek fetch returned no valid document content");
    const max_chars = Number.isFinite(input.max_chars)
      ? Math.min(100_000, Math.max(1, Math.floor(input.max_chars ?? 40_000)))
      : 40_000;
    return {
      provider: this.name,
      url: input.url,
      title: payload.data.title || null,
      content: payload.data.content.slice(0, max_chars),
    };
  }
}
