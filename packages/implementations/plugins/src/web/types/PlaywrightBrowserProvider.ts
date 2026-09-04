/**
 * PlaywrightBrowserProvider 构造参数类型。
 *
 * 关键点（中文）：只描述连接策略，不把 Playwright 运行时对象放入公开 action 协议。
 */

/** Playwright CDP 浏览器 provider 构造参数。 */
export interface PlaywrightBrowserProviderOptions {
  /** Chrome DevTools Protocol 地址，例如 `http://127.0.0.1:9222`。 */
  cdp_url: string;
  /** 创建 session 后未提供 URL 时打开的默认页面。 */
  default_url?: string;
  /** 页面导航、点击和填充的默认超时毫秒数。 */
  timeout_ms?: number;
  /** 页面观察默认返回的最大字符数。 */
  max_observation_chars?: number;
}
