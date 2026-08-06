/** Fedman 同源 BFF API Client。 */

import type { AnalyticsRange } from "../types/navigation.js";

/** 请求同源 CLI BFF 并统一处理 JSON 错误。 */
export async function request_json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") {
      window.dispatchEvent(new Event("fedman:unauthorized"));
    }
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }
  return body;
}

/** 构建带时间范围和浏览器 IANA 时区的 Analytics URL。 */
export function analytics_url(kind: "overview" | "users" | "retention", range: AnalyticsRange): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return `/api/usage/${kind}?range=${range}&timezone=${encodeURIComponent(timezone)}`;
}
