/**
 * Accounts 服务数据库读取行类型。
 *
 * 关键说明（中文）
 * - 这些类型描述原始 SQL 读取结果，不作为对外 API 暴露。
 * - 拆出后主服务模块只负责认证流程与路由注册。
 */

/**
 * better-auth 用户表读取结果。
 */
export interface AuthUserRow extends Record<string, unknown> {
  /** `auth_users.id`。 */
  id: string;
  /** 主邮箱。 */
  email: string;
  /** 邮箱是否已验证。 */
  emailVerified: number | boolean;
  /** better-auth 原生展示名。 */
  name: string;
  /** better-auth 原生头像 URL。 */
  image: string | null;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
}

/**
 * better-auth account 表读取结果。
 */
export interface AuthAccountRow extends Record<string, unknown> {
  /** `auth_accounts.id`。 */
  id: string;
  /** 绑定的 `auth_users.id`。 */
  userId: string;
}

/**
 * 登录 state 记录。
 */
export interface LoginStateRow extends Record<string, unknown> {
  /** 登录流程 ID；OAuth 流程中也作为 OAuth state。 */
  state: string;
  /** 目标 bureau_id。 */
  bureau_id: string;
  /** provider 标识。 */
  provider: string;
  /** 完成后回填的 City user_token。 */
  user_token: string;
  /** 创建时间戳。 */
  created_at: number;
}
