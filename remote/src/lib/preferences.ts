/** 连接偏好与输入验证：仅保存不含凭据的 City 地址，存储不可用时照常使用页面。 */
import { normalize_city_url } from "./endpoint";

const city_address_key = "downcity.remote.city_url";

/** 成功连接后记住公开地址，不接收或写入 token。 */
export function remember_city_url(city_url: string): void {
  try { localStorage.setItem(city_address_key, normalize_city_url(city_url)); } catch { /* 隐私模式不影响连接。 */ }
}

/** 只展示可读错误，网络失败提示到连接所需条件。 */
export function connection_error(error: unknown): string {
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return "Cannot reach this City. Check that City is running and the address is reachable. For a local connection, allow local network access in your browser’s site permissions. The City must also allow this page’s origin (CORS).";
  }
  return error instanceof Error ? error.message : String(error);
}
