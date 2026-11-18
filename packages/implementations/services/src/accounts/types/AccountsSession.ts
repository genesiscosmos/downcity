/** Accounts 设备会话续期和撤销的 HTTP 请求协议。 */

/** 刷新由凭证和请求证明共同认证，不依赖尚未到期的访问 JWT。 */
export interface AccountsRefreshRequest extends Record<string, unknown> {
  /** 上一次成功保存的私密轮换凭证。 */
  refresh_token: string;
  /** 发出请求前持久化的随机请求 ID；网络失败重试必须复用。 */
  refresh_id: string;
}

/** 刷新凭证或已认证 Bearer 访问凭证均可撤销当前设备会话。 */
export interface AccountsLogoutRequest extends Record<string, unknown> {
  /** 私密刷新凭证；省略时必须提供有效 Bearer 访问凭证。 */
  refresh_token?: string;
}
