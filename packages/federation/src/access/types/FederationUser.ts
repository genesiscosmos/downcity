/**
 * Federation 当前用户类型。
 */

import type { UserProfile } from "../../types/User.js";

/** Federation 当前用户的可信身份。 */
export interface FederationCurrentUserIdentity extends Record<string, unknown> {
  /** Federation 用户 ID。 */
  user_id: string;

  /** User Token 绑定的 Bureau ID。 */
  bureau_id: string;
}

/** federation.user.current 返回结果。 */
export interface FederationCurrentUser {
  /** 已由 Federation 验证的用户身份。 */
  user: FederationCurrentUserIdentity;

  /** Federation 中保存的用户资料。 */
  profile: UserProfile | null;
}
