/**
 * Embassy 内部构造依赖类型。
 */

import type { FetchLike } from "../../pact/http.js";
import type { ServiceClient } from "../../pact/invoker/invoker.js";

/** EmbassyAccount 内部依赖。 */
export interface EmbassyAccountOptions {
  /** 动态获取当前 Accounts Service 调用器。 */
  accounts: () => ServiceClient;

  /** 读取当前 Embassy User Token。 */
  read_user_token: () => string | undefined;

  /** 更新当前 Embassy User Token。 */
  update_user_token: (user_token: string | undefined) => void;

  /** 当前 Embassy 默认 Bureau ID。 */
  bureau_id?: string;
}

/** EmbassyUser 内部构造参数。 */
export interface EmbassyUserOptions {
  /** Federation HTTP(S) 入口。 */
  federation_url: string;

  /** 当前默认 Bureau ID。 */
  bureau_id?: string;

  /** 当前 User Token。 */
  user_token?: string;

  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
}

/** EmbassyAdmin 内部构造参数。 */
export interface EmbassyAdminOptions {
  /** Federation HTTP(S) 入口。 */
  federation_url: string;

  /** 当前管理员 Session Token。 */
  admin_token?: string;

  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
}
