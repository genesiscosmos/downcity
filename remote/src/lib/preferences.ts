/**
 * 浏览器连接偏好：只有用户主动选择时保存地址与凭据；所有存储读写都允许失败。
 * 不持久化消息或会话状态，不把凭据放入 URL、错误文本或日志。
 */
import { normalize_city_url } from "./endpoint";
import type { Remembered_connection, Remote_locale } from "../types/remote";

const connection_key = "downcity.remote.connection";

/** 只恢复结构完整且地址合法的连接，不回显原始存储内容。 */
export function read_remembered_connection(): Remembered_connection | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(connection_key) ?? "null");
    if (!value || typeof value !== "object" || !("city_url" in value) || !("token" in value)
      || typeof value.city_url !== "string" || typeof value.token !== "string" || !value.token.trim()) return;
    return { city_url: normalize_city_url(value.city_url), token: value.token };
  } catch { return; }
}

/** 存储失败只影响记住能力，由调用方提示，不能阻止当前连接。 */
export function save_remembered_connection(connection: Remembered_connection): boolean {
  try { localStorage.setItem(connection_key, JSON.stringify(connection)); return true; }
  catch { return false; }
}

/** 清除成功后才能向用户确认已忘记；不影响 City 侧授权。 */
export function forget_remembered_connection(): boolean {
  try { localStorage.removeItem(connection_key); return true; }
  catch { return false; }
}

/** 仅识别宿主明确返回的 City 凭据错误，不把网络或权限变化推断为过期。 */
export function is_credential_error(error: unknown): boolean {
  return error instanceof Error && /^(Invalid or expired City Token|City HTTP 401|HTTP 401)$/.test(error.message);
}

/** 使用固定文案说明失败，避免把服务端响应中的私密数据直接呈现出来。 */
export function connection_error(error: unknown, locale: Remote_locale = "en"): string {
  const text = (en: string, zh: string) => locale === "zh" ? zh : en;
  if (is_credential_error(error)) return text(
    "This City Code is no longer valid. Enter a new City Code.",
    "此 City 连接码已失效，请输入新的 City 连接码。",
  );
  // City 发现接口对无权限、过期和撤销均返回空列表，不能据此删除保存的凭据。
  if (error instanceof Error && ["No authorized Agents", "Invalid City Token or Agent access denied"].includes(error.message)) return text(
    "No Agents are available with this City Code. It may have expired or been revoked. Ask the City owner for a new City Code.",
    "此 City 连接码下暂无可访问的 Agent，可能已过期或被撤销。请向 City 拥有者索取新的 City 连接码。",
  );
  if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) return text(
    "Cannot reach this City. Check the connection and try again. See Guide for browser access requirements.",
    "暂时无法连接此 City，请检查网络后重试。浏览器访问要求见使用指南。",
  );
  return text("Could not complete the request. Try again or check Guide.", "未能完成请求，请重试或查看使用指南。");
}
