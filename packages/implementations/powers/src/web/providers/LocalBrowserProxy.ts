/**
 * 将公共出站代理策略转换成 Chrome 启动参数。
 *
 * 关键点（中文）：浏览器使用独立网络栈，不能依赖 Node 环境变量自动生效；
 * profile 只保存参数摘要用于判断能否复用进程，不保存代理地址或凭据。
 */

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  resolve_outbound_no_proxy_rules,
  resolve_outbound_proxy_url,
} from "@downcity/city/http";

/** 按当前进程配置生成 Chrome 代理参数；无显式代理时沿用系统设置。 */
export function resolve_local_browser_proxy_args(): string[] {
  const proxy_url = resolve_outbound_proxy_url();
  if (!proxy_url) return [];
  let proxy: URL;
  try {
    proxy = new URL(proxy_url);
  } catch {
    throw new Error("Local browser proxy must be a valid HTTP, HTTPS, SOCKS4 or SOCKS5 URL");
  }
  if (!["http:", "https:", "socks4:", "socks5:"].includes(proxy.protocol)
    || proxy.username || proxy.password
    || (proxy.pathname !== "/" && proxy.pathname !== "")
    || proxy.search || proxy.hash) {
    throw new Error("Local browser proxy requires an HTTP, HTTPS, SOCKS4 or SOCKS5 URL without credentials, path or query");
  }
  const bypass_rules = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const rule of resolve_outbound_no_proxy_rules()) {
    // Chromium 域名规则默认仅匹配自身；公共 NO_PROXY 还包含其子域。
    const normalized = rule.replace(/^\*?\./u, "");
    if (!normalized) continue;
    if (isIP(normalized) === 6) {
      bypass_rules.add(`[${normalized}]`);
      continue;
    }
    bypass_rules.add(normalized);
    const host = normalized.replace(/:\d+$/u, "");
    if (normalized !== "*" && !normalized.includes("/")
      && !normalized.includes("[") && !isIP(host)) {
      bypass_rules.add(`*.${normalized}`);
    }
  }
  return [
    `--proxy-server=${proxy.protocol}//${proxy.host}`,
    `--proxy-bypass-list=${[...bypass_rules].join(";")}`,
  ];
}

/** 生成可写入 profile 的代理配置摘要，避免把代理信息写入磁盘。 */
export function local_browser_proxy_key(proxy_args: string[]): string {
  return createHash("sha256").update(JSON.stringify(proxy_args)).digest("hex");
}
