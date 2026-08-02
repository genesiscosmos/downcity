/**
 * City user session 类型。
 *
 * 关键点（中文）
 * - 这些类型只描述 City 本地 user 登录态。
 * - `city` CLI 的 admin 配置不使用这些类型。
 */

/**
 * City 保存的 user session。
 */
export interface CityUserSession {
  /**
   * Federation 地址。
   */
  federation_url: string;

  /**
   * 当前 user token 绑定的 city id。
   */
  bureau_id: string;

  /**
   * City 用户 ID。
   */
  user_id?: string;

  /**
   * 用户展示名称，例如 email 或 OAuth 标识。
   */
  user_label?: string;

  /**
   * City user token 明文。
   *
   * 说明（中文）
   * - 仅在 City 本地加密存储中保存。
   * - CLI 状态输出只能展示是否存在，不输出明文。
   */
  user_token: string;

  /**
   * session 最后更新时间。
   */
  updated_at: string;
}

/**
 * City user 登录输入。
 */
export interface CityLoginInput {
  /**
   * Federation 地址。
   */
  federation_url: string;

  /**
   * 登录后 session 使用的 city id。
   */
  bureau_id: string;
}
