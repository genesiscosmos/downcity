/**
 * Admin 鉴权错误工具。
 *
 * 关键说明（中文）
 * - 当管理员 Session 不正确或已失效时，SDK 会把请求失败包装成带 `status` 的 Error。
 * - 这里统一把 401 转成可识别的 AdminAuthError，方便外层清理缓存 session 并提示重新输入。
 */

/**
 * 管理员 Session 无效时给用户展示的统一提示。
 */
export const ADMIN_AUTH_INVALID_MESSAGE =
  "Current administrator session is invalid or expired. Please log in again.";

interface HttpClientError extends Error {
  /** HTTP 状态码 */
  status?: number;
}

/**
 * 判断服务端是否缺少新接口。
 */
export function isAdminNotFoundError(error: unknown): boolean {
  return (error as HttpClientError | undefined)?.status === 404;
}

/**
 * admin 鉴权失效错误。
 */
export class AdminAuthError extends Error {
  constructor(message = ADMIN_AUTH_INVALID_MESSAGE) {
    super(message);
    this.name = "AdminAuthError";
  }
}

/**
 * 判断当前错误是否是 admin 鉴权失效。
 */
export function isAdminAuthError(error: unknown): error is AdminAuthError {
  return error instanceof AdminAuthError;
}

/**
 * 如果底层错误是 401，则提升为 AdminAuthError。
 */
export function rethrowAdminAuthError(error: unknown): void {
  const status = (error as HttpClientError | undefined)?.status;
  if (status === 401) {
    throw new AdminAuthError();
  }
}

/**
 * 提取可展示的错误文本。
 */
export function adminErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
