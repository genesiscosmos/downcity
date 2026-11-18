/** 登录会话重试时复用的 JWT 签发事实，完全由服务端构造。 */
export interface UserSessionAccessClaims {
  /** 当前轮次的签发时间，Unix 秒；恢复过期响应时可重新签发短期访问凭证。 */
  issued_at: number;
  /** 绑定会话及当前凭证摘要的稳定 JWT ID，不包含刷新秘密。 */
  token_id: string;
}
