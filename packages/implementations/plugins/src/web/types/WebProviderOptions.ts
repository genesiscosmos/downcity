/**
 * Web 内建 Provider 的构造参数。
 *
 * 关键点（中文）：凭据只在运行时对象中使用，不进入 Action 返回值。
 */

/** Web HTTP 请求的公共限制。 */
export interface WebHttpProviderOptions {
  /** 单次网络请求超时毫秒数。 */
  readonly timeout_ms?: number;
  /** 单次响应允许读取的最大字节数。 */
  readonly max_response_bytes?: number;
}

/** Tavily 搜索 Provider 构造参数。 */
export interface TavilySearchProviderOptions extends WebHttpProviderOptions {
  /** Tavily API Key。 */
  readonly api_key: string;
}

/** Exa 搜索 Provider 构造参数。 */
export interface ExaSearchProviderOptions extends WebHttpProviderOptions {
  /** Exa API Key。 */
  readonly api_key: string;
}

/** Firecrawl 文档 Provider 构造参数。 */
export interface FirecrawlDocumentProviderOptions extends WebHttpProviderOptions {
  /** Firecrawl API Key。 */
  readonly api_key: string;
}

/** 无密钥 Fetch 文档 Provider 构造参数。 */
export interface FetchDocumentProviderOptions extends WebHttpProviderOptions {
  /** 默认返回正文的最大字符数。 */
  readonly max_chars?: number;
}

/** WebPlugin 自动启动本地浏览器的参数。 */
export interface LocalBrowserProviderOptions {
  /** 本地浏览器 profile 的持久化目录。 */
  readonly profile_path: string;
  /** 可选 Chrome/Chromium 可执行文件路径；未指定时自动发现。 */
  readonly executable_path?: string;
  /** 创建 Session 时未提供 URL 使用的默认地址。 */
  readonly default_url?: string;
  /** 浏览器启动和页面操作超时毫秒数。 */
  readonly timeout_ms?: number;
  /** 页面观察默认返回的最大字符数。 */
  readonly max_observation_chars?: number;
}
