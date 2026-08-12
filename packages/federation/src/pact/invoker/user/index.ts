/**
 * Federation 用户数据调用器。
 *
 * City 直接通过该调用器访问 Federation Accounts，不依赖 Bureau。
 */

import type { RequestInitLike } from "../../http.js";
import type { UserProfile } from "../../../types/User.js";

/** Federation 当前用户调用入口。 */
export class UserInvoker {
  private readonly request_json: <T>(path: string, init: RequestInitLike) => Promise<T>;
  private readonly has_user_token: () => boolean;

  constructor(options: {
    requestJSON: <T>(path: string, init: RequestInitLike) => Promise<T>;
    hasUserToken: () => boolean;
  }) {
    this.request_json = options.requestJSON;
    this.has_user_token = options.hasUserToken;
  }

  /** 读取 Federation 当前用户 Profile。 */
  async profile(): Promise<UserProfile | null> {
    if (!this.has_user_token()) throw new TypeError("user_token is required for profile()");
    const body = await this.request_json<{ profile?: UserProfile | null }>("/v1/accounts/me", {
      method: "GET",
    });
    return body.profile ?? null;
  }
}
