/**
 * CLI临时Downtown目标解析。地址确定后才读取对应凭据，不改变选中连接。
 * 环境token只属于环境地址或当前选中地址，不允许借临时url转发给其他实例。
 */
import {
  normalize_downtown_url, resolve_selected_downtown_url,
  read_downtown_session_for_downtown, read_downtown_admin_session_for_url,
} from "./DowncityConfigStore.js";
import type { DowntownAccessTarget } from "../types/DowntownAccess.js";

/** 验证基础URL，拒绝把凭据放在URL或动态query中。 */
export function validate_downtown_access_url(value: string): string {
  const normalized = normalize_downtown_url(value);
  const parsed = new URL(normalized);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError("Downtown URL must be HTTP(S) without credentials, query or fragment.");
  }
  if (parsed.pathname.split("/").some(part => decodeURIComponent(part) === "." || decodeURIComponent(part) === "..")) {
    throw new TypeError("Invalid Downtown base path.");
  }
  return normalized;
}

/** 读取目标；公开查询时不读取任何用户或管理员凭据。 */
export function resolve_downtown_access_target(url?: string, credentials: "public" | "user" | "admin" = "public"): DowntownAccessTarget {
  const default_url = process.env.DOWNCITY_DOWNTOWN_URL?.trim() || resolve_selected_downtown_url();
  const target_url = validate_downtown_access_url(url?.trim() || default_url);
  if (credentials === "public") return { url: target_url };
  if (credentials === "admin") {
    return { url: target_url, admin_token: read_downtown_admin_session_for_url(target_url) };
  }
  const env_token = process.env.DOWNCITY_USER_TOKEN?.trim();
  if (env_token && target_url === validate_downtown_access_url(default_url)) {
    return { url: target_url, user_token: env_token };
  }
  const session = read_downtown_session_for_downtown(target_url);
  return { url: target_url, user_token: session?.user_token, session_id: session?.session_id };
}
