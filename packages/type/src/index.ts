/**
 * @downcity/type 公共协议入口。
 *
 * 这里只导出跨 package 共享的稳定协议，具体运行时实现由各 SDK package 自己负责。
 */

export {
  CITY_MODEL_KIND,
  isCityModel,
} from "./types/CityModel.js";

export type {
  CityModel,
  CityModelDescriptor,
  CityModelEnvRequirement,
  CityModelReasoning,
  CityModelReasoningEffort,
} from "./types/CityModel.js";

export {
  AUTH_DEFAULT_ROLE_NAMES,
  AUTH_DEFAULT_ROLES,
  AUTH_PERMISSION_DESCRIPTIONS,
  AUTH_PERMISSION_KEYS,
} from "./types/auth/AuthPermission.js";
export type {
  AuthDefaultRoleDefinition,
  AuthDefaultRoleName,
  AuthPermissionKey,
} from "./types/auth/AuthPermission.js";
export type { AuthRoutePolicy } from "./types/auth/AuthRoute.js";
export type { AuthIssuedToken, AuthTokenSummary } from "./types/auth/AuthToken.js";
export type {
  AuthAuditLog,
  AuthPermission,
  AuthPrincipal,
  AuthRole,
  AuthTokenRecord,
  AuthUser,
  AuthUserStatus,
} from "./types/auth/AuthTypes.js";
