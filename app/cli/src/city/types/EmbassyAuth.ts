/**
 * CLI Embassy 用户鉴权交互类型。
 *
 * 关键点（中文）
 * - 登录 Provider 与状态机协议由 `@downcity/federation` 的 Embassy 类型唯一拥有。
 * - 本模块只描述 CLI 自己的菜单选项，以及邮箱注册专用响应。
 */

/**
 * 登录方式。
 */
export type EmbassyAuthMethod = "login" | "register" | `oauth:${string}` | `input:${string}`;

/**
 * CLI 登录菜单选项。
 */
export interface AuthOption {
  /**
   * 选项标题。
   */
  title: string;

  /**
   * 选项值。
   */
  value: EmbassyAuthMethod;

  /**
   * 选项说明。
   */
  description: string;
}

/**
 * email register 结果。
 */
export interface RegisterResult {
  /**
   * 注册是否成功。
   */
  success?: boolean;

  /**
   * 服务端提示。
   */
  message?: string;

  /**
   * 验证 token。
   */
  verification_token?: string;

  /**
   * 用户 ID。
   */
  user_id?: string;

  /**
   * 服务端错误信息。
   */
  error?: string;
}

/**
 * email verify 结果。
 */
export interface VerifyResult {
  /** Federation User Token。 */
  user_token?: string;

  /**
   * 用户 ID。
   */
  user_id?: string;

  /**
   * 服务端错误信息。
   */
  error?: string;
}
