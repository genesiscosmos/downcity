/**
 * Federation Embassy 客户端入口。
 *
 * Embassy 只表达 Federation 入口，并公开 user 和 admin 两个身份子域。
 * 产品分区属于具体登录请求，不进入 Embassy 生命周期。
 */

import { EmbassyAdmin } from "./EmbassyAdmin.js";
import { EmbassyUser } from "./EmbassyUser.js";
import type { EmbassyOptions } from "./types/EmbassyOptions.js";

/** Federation 统一访问入口。 */
export class Embassy {
  /** Federation 用户身份子域。 */
  readonly user: EmbassyUser;

  /** Federation 管理员身份子域。 */
  readonly admin: EmbassyAdmin;

  constructor(options: EmbassyOptions) {
    if (!options || typeof options !== "object") {
      throw new TypeError("Embassy options are required");
    }
    this.user = new EmbassyUser({
      federation_url: options.federation_url,
      user_token: options.user_token,
      fetch: options.fetch,
    });
    this.admin = new EmbassyAdmin({
      federation_url: options.federation_url,
      admin_token: options.admin_token,
      fetch: options.fetch,
    });
  }
}
