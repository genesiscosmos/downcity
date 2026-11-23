/** 用户登录会话协议；访问凭证与刷新凭证只交付给完成认证的客户端。 */
export interface UserSessionCredentials {
  /** 短期 Bearer JWT，不得输出到日志。 */
  user_token: string;
  /** 高熵轮换凭证，只允许保存在本地私密存储。 */
  refresh_token: string;
  /** 访问凭证到期时间，ISO 8601。 */
  expires_at: string;
  /** 闲置会话到期时间，ISO 8601；成功刷新后延长。 */
  refresh_expires_at: string;
  /** 当前设备登录会话的稳定 ID。 */
  session_id: string;
}
/** 服务端刷新记录；只持久化凭证摘要。 */
export interface UserSessionRecord extends Record<string, unknown> {
  /** 当前登录的稳定标识。 */
  session_id: string;
  /** 已认证的用户 ID。 */
  user_id: string;
  /** 当前刷新凭证的 SHA-256。 */
  token_hash: string;
  /** 上一轮凭证的 SHA-256，供丢失响应恢复和退出使用。 */
  previous_hash: string;
  /** 上一次刷新请求 ID 的摘要。 */
  refresh_id_hash: string;
  /** 最近一次刷新后的闲置到期时间，Unix 毫秒。 */
  expires_at: number;
  /** 已撤销为 1，正常为 0。 */
  revoked: number;
}
