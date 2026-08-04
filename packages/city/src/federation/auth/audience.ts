/**
 * Federation User Token audience 规则。
 *
 * Federation audience 在此统一定义；Bureau audience 直接使用 opaque `bureau_id`。
 */

/** Federation 自身接收 User Token 时校验的 audience。 */
export const FEDERATION_USER_TOKEN_AUDIENCE = "downcity:federation" as const;
