/**
 * Embassy 构造参数类型。
 *
 * Embassy 只保存当前进程中的访问上下文，不负责宿主的凭证持久化。
 */

import type { FetchLike } from "../../pact/http.js";

/** Embassy 构造参数。 */
export interface EmbassyOptions {
  /** 预先信任的 Federation HTTP(S) 入口。 */
  federation_url: string;

  /** Federation 签发的终端用户 Token。 */
  user_token?: string;

  /** Federation 签发的管理员 Session Token。 */
  admin_token?: string;

  /** 自定义 fetch 实现，主要用于非标准运行时和测试。 */
  fetch?: FetchLike;

}
