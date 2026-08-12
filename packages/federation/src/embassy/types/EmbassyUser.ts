/**
 * Embassy 当前用户类型。
 */

import type { UserProfile } from "../../types/User.js";

/** Federation 当前用户的可信身份。 */
export interface EmbassyCurrentUserIdentity extends Record<string, unknown> {
  /** Federation 用户 ID。 */
  user_id: string;

  /** User Token 绑定的 Bureau ID。 */
  bureau_id: string;
}

/** embassy.user.current 返回结果。 */
export interface EmbassyCurrentUser {
  /** 已由 Federation 验证的用户身份。 */
  user: EmbassyCurrentUserIdentity;

  /** Federation 中保存的用户资料。 */
  profile: UserProfile | null;
}
