/**
 * Service 用户身份读取边界。
 *
 * Federation 已完成 Token 验证，本模块只把已验证的 user 身份投影给业务服务。
 */

import {
  httpError,
  type ServiceRouteContext,
} from "@downcity/downtown";

/** 读取当前请求已验证的用户身份。 */
export function require_service_user_identity(context: ServiceRouteContext) {
  const user_id = context.user?.user_id;
  if (!user_id) {
    throw httpError(401, "AUTH_REQUIRED");
  }
  return { user_id };
}
