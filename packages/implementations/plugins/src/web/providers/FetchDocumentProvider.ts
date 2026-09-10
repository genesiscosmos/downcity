/**
 * 无密钥的安全 HTTP 文档 Provider。
 *
 * 关键点（中文）：只读取公网 HTTP(S) 文档，不执行页面脚本；复杂动态页面应交给
 * Firecrawl 或 BrowserProvider。
 */

import type { WebDocumentProvider, WebOpenInput, WebOpenResult } from "@/web/types/WebPlugin.js";
import type { FetchDocumentProviderOptions } from "@/web/types/WebProviderOptions.js";
import { safe_fetch } from "@/web/providers/WebHttp.js";

const DEFAULT_MAX_CHARS = 40_000;

/** 直接读取静态 HTML 或文本的内建 Provider。 */
export class FetchDocumentProvider implements WebDocumentProvider {
  readonly name = "fetch";

  constructor(private readonly options: FetchDocumentProviderOptions = {}) {}

  async open(input: WebOpenInput): Promise<WebOpenResult> {
    const response = await safe_fetch(input.url, {
      timeout_ms: this.options.timeout_ms,
      max_response_bytes: this.options.max_response_bytes,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.1",
        "user-agent": "Downcity-WebPlugin/1.0",
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Web document request failed with HTTP ${response.status}`);
    }
    const is_html = /(?:text\/html|application\/xhtml\+xml)/iu.test(response.content_type)
      || /^\s*<!doctype html|^\s*<html/iu.test(response.text);
    const title = is_html ? read_html_title(response.text) : null;
    const content = is_html ? html_to_text(response.text) : response.text.trim();
    const max_chars = normalize_max_chars(input.max_chars ?? this.options.max_chars);
    return {
      provider: this.name,
      url: response.url,
      title,
      content: content.slice(0, max_chars),
    };
  }
}

/** 提取 HTML title。 */
function read_html_title(html: string): string | null {
  const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/iu.exec(html);
  return match ? decode_html(match[1]).replace(/\s+/gu, " ").trim() || null : null;
}

/** 把 HTML 转成紧凑、可读的纯文本。 */
function html_to_text(html: string): string {
  return decode_html(html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(?:script|style|noscript|svg|canvas|template)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg|canvas|template)>/giu, " ")
    .replace(/<(?:br|hr)\s*\/?\s*>/giu, "\n")
    .replace(/<\/(?:p|div|section|article|main|header|footer|nav|aside|h[1-6]|li|tr|blockquote)>/giu, "\n")
    .replace(/<[^>]+>/gu, " "))
    .replace(/[\t ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** 解码文档中最常见的 HTML entity。 */
function decode_html(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
    if (code.startsWith("#x")) return safe_code_point(Number.parseInt(code.slice(2), 16), entity);
    if (code.startsWith("#")) return safe_code_point(Number.parseInt(code.slice(1), 10), entity);
    return named[code.toLowerCase()] ?? entity;
  });
}

/** 安全地把 Unicode code point 转成字符串。 */
function safe_code_point(code_point: number, fallback: string): string {
  try {
    return String.fromCodePoint(code_point);
  } catch {
    return fallback;
  }
}

/** 归一化正文字符限制。 */
function normalize_max_chars(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_CHARS;
  return Math.min(100_000, Math.max(1, Math.floor(value ?? DEFAULT_MAX_CHARS)));
}
