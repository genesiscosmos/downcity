/**
 * Federation User Token audience 规则。
 *
 * Federation 与 Bureau 属于同一用户服务面，共用一个稳定 audience；Bureau 的
 * 产品作用域由已签名的 `bureau_id` Claim 表达。
 */

/** Federation 与 Bureau 共同接收 User Token 时校验的唯一 audience。 */
export const USER_TOKEN_AUDIENCE = "downcity:user" as const;
