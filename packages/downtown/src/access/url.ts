/** Downtown 基础地址校验；保留部署路径，拒绝隐式凭证、查询和 fragment。 */
export function normalize_downtown_url(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Downtown url must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("Downtown url must not contain credentials, query or fragment");
  }
  return url.toString().replace(/\/+$/u, "");
}
