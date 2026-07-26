/**
 * 跨 package 统一账户路由策略类型。
 *
 * 关键点（中文）
 * - 当前文件先定义协议，后续路由全面切入 Bearer 鉴权时直接复用。
 */

/**
 * 单条路由的鉴权策略。
 */
export interface AuthRoutePolicy {
  /**
   * 路由路径模式。
   */
  path: string;
  /**
   * HTTP 方法。
   */
  method: string;
  /**
   * 是否必须登录。
   */
  require_auth: boolean;
}
