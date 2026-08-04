/**
 * Federation User Token audience 规则。
 *
 * Federation 与 Bureau 共用该模块，避免签发端和本地验签端拼接出不同受众。
 */

/** Federation 自身接收 User Token 时校验的 audience。 */
export const FEDERATION_USER_TOKEN_AUDIENCE = "downcity:federation" as const;

/** 构造指定 Bureau 的 User Token audience。 */
export function bureau_user_token_audience(bureau_id: string): string {
  if (typeof bureau_id !== "string" || bureau_id.length === 0) {
    throw new TypeError("bureau_id is required");
  }
  return `urn:downcity:bureau:${bureau_id}`;
}
