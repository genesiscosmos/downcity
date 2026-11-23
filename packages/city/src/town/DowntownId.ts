/** Downtown 地址与内部 ID：规范化地址后派生稳定标识，用户无需输入或查看。 */
import { createHash } from "node:crypto";

/** 保留协议、有效端口与部署路径，拒绝 URL 中的凭据和临时参数。 */
export function normalize_downtown_url(value: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.includes("?") || url.href.includes("#")) {
    throw new TypeError("Downtown URL must be HTTP(S) without credentials, query or fragment");
  }
  return url.toString().replace(/\/+$/u, "");
}

/** 取 SHA-256 的前 132 位；ID 仅作本地关联，不用于认证，也不反解地址。 */
export function create_downtown_id(url: string): string {
  return createHash("sha256").update(normalize_downtown_url(url)).digest("base64url").slice(0, 22);
}

/** SDK 登记 ID 可以由宿主提供，空白和空 ID 无法构成稳定引用。 */
export function assert_downtown_id(id: string): void {
  if (typeof id !== "string" || !id || id !== id.trim()) throw new TypeError("town_invalid_downtown_id");
}
