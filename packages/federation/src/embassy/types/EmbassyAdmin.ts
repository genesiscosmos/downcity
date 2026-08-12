/**
 * Embassy 管理员账户类型。
 */

/** Federation 管理员登录输入。 */
export interface EmbassyAdminLoginInput {
  /** fed deploy admin-reset 配置的管理员 ID。 */
  admin_id: string;

  /** 管理员明文密码，仅用于本次登录。 */
  password: string;
}

/** Federation 管理员登录结果。 */
export interface EmbassyAdminSession {
  /** 当前管理员 ID。 */
  admin_id: string;

  /** 有期限且可撤销的管理员 Session Token。 */
  session_token: string;

  /** Session 的 ISO 8601 到期时间。 */
  expires_at: string;
}

/** Federation 当前管理员 Session。 */
export interface EmbassyCurrentAdmin {
  /** 当前请求是否已经认证。 */
  authenticated: true;

  /** 当前管理员 ID。 */
  admin_id: string;

  /** 当前管理员 Session ID。 */
  session_id: string;
}
