/**
 * Auth 领域错误定义。
 *
 * 关键点（中文）
 * - 用统一错误类把 HTTP 状态码和业务语义绑在一起。
 * - 路由层只负责把错误转成响应，不负责猜测状态码。
 */

/**
 * Auth 业务错误。
 */
export class AuthError extends Error {
  /**
   * HTTP 状态码。
   */
  readonly status: 400 | 401 | 403 | 404;

  constructor(message: string, status: 400 | 401 | 403 | 404) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * 判断是否为 AuthError。
 */
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
