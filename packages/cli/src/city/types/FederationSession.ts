/**
 * Federation 用户会话类型。
 *
 * 关键点（中文）
 * - 这些类型只描述 Downcity CLI 通过 Federation 保存的用户登录态。
 * - Federation 管理员配置不使用这些类型。
 */

/**
 * Downcity 保存的 Federation User Session。
 */
export interface FederationUserSession {
  /**
   * Federation 地址。
   */
  federation_url: string;


  /**
   * Federation User ID。
   */
  user_id?: string;

  /**
   * 用户展示名称，例如 email 或 OAuth 标识。
   */
  user_label?: string;

  /**
   * Federation User Token 明文。
   *
   * 说明（中文）
   * - 仅在权限受限的 Downcity 本地数据库中保存。
   * - CLI 状态输出只能展示是否存在，不输出明文。
   */
  user_token: string;
  /** 共享凭证仓储中的稳定登录 ID，运行时按此读取最新凭证。 */
  session_id?: string;

  /**
   * session 最后更新时间。
   */
  updated_at: string;
}

/**
 * Federation 用户登录输入。
 */
export interface FederationLoginInput {
  /**
   * Federation 地址。
   */
  federation_url: string;

}
