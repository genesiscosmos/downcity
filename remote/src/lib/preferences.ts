/** 连接偏好与输入验证：仅保存不含凭据的 City 地址，存储不可用时照常使用页面。 */
const city_address_key = "downcity.remote.city_url";

/** 校验解析后的 City 地址，凭据只由连接码单独传给 SDK。 */
export function normalize_city_url(value: string): string {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("The connection code must contain an HTTP/HTTPS City address without embedded credentials, query parameters or a fragment.");
  }
  if (window.location.protocol === "https:" && url.protocol === "http:") {
    throw new Error("This HTTPS page requires an HTTPS City address.");
  }
  return url.toString().replace(/\/+$/, "");
}

/** 成功连接后记住公开地址，不接收或写入 token。 */
export function remember_city_url(city_url: string): void {
  try { localStorage.setItem(city_address_key, normalize_city_url(city_url)); } catch { /* 隐私模式不影响连接。 */ }
}

/** 只展示可读错误，网络失败提示到连接所需条件。 */
export function connection_error(error: unknown): string {
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return "Cannot reach this City. Check its address, network access and allowed browser origin (CORS).";
  }
  return error instanceof Error ? error.message : String(error);
}
