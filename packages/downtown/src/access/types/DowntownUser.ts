/**
 * Downtown 当前用户类型。
 */

import type { UserProfile } from "../../types/User.js";

/** Downtown 当前用户的可信身份。 */
export interface DowntownCurrentUserIdentity extends Record<string, unknown> {
  /** Downtown 用户 ID。 */
  user_id: string;

}

/** downtown.user.current 返回结果。 */
export interface DowntownCurrentUser {
  /** 已由 Downtown 验证的用户身份。 */
  user: DowntownCurrentUserIdentity;

  /** Downtown 中保存的用户资料。 */
  profile: UserProfile | null;
}
