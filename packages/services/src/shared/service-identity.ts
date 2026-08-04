/**
 * Service 用户身份读取边界。
 *
 * Federation 已完成 Token 验证，本模块只把已验证的 user 与 Bureau 身份投影给业务服务。
 * `bureau_id` 在这里按 opaque 值原样返回，不允许业务模块再次规范化。
 */

import {
  httpError,
  type ServiceRouteContext,
} from "@downcity/city";

/** 读取当前请求已验证的用户与 Bureau 身份。 */
export function require_service_user_identity(context: ServiceRouteContext) {
  const user_id = context.user?.user_id;
  const bureau_id = context.bureau?.bureau_id;
  if (!user_id || !bureau_id) {
    throw httpError(401, "AUTH_REQUIRED");
  }
  return { user_id, bureau_id };
}
