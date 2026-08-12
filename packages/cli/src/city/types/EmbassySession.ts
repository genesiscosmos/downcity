/**
 * Embassy 用户会话类型。
 *
 * 关键点（中文）
 * - 这些类型只描述 Downcity CLI 通过 Embassy 保存的用户登录态。
 * - Federation 管理员配置不使用这些类型。
 */

/**
 * Downcity 保存的 Embassy User Session。
 */
export interface EmbassyUserSession {
  /**
   * Federation 地址。
   */
  federation_url: string;

  /**
   * 当前 user token 绑定的 Bureau ID。
   */
  bureau_id: string;

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
   * - 仅在 Downcity 本地加密存储中保存。
   * - CLI 状态输出只能展示是否存在，不输出明文。
   */
  user_token: string;

  /**
   * session 最后更新时间。
   */
  updated_at: string;
}

/**
 * Embassy 用户登录输入。
 */
export interface EmbassyLoginInput {
  /**
   * Federation 地址。
   */
  federation_url: string;

  /**
   * 登录时选择的 Bureau ID。
   */
  bureau_id: string;
}
