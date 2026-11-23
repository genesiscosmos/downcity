/**
 * Downtown User Token audience 规则。
 *
 * Downtown 用户服务面使用稳定 audience；来源标签不参与 Token 授权。
 */

/** Downtown 接收 User Token 时校验的唯一 audience。 */
export const USER_TOKEN_AUDIENCE = "downcity:user" as const;
