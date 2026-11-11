/**
 * Federation 内部构造依赖类型。
 */

import type { FetchLike } from "../../pact/http.js";
import type { ServiceClient } from "../../pact/invoker/invoker.js";

/** FederationAccount 内部依赖。 */
export interface FederationAccountOptions {
  /** 动态获取当前 Accounts Service 调用器。 */
  accounts: () => ServiceClient;

  /** 读取当前 Federation User Token。 */
  read_user_token: () => string | undefined;

  /** 更新当前 Federation User Token。 */
  update_user_token: (user_token: string | undefined) => void;
}

/** FederationUser 内部构造参数。 */
export interface FederationUserOptions {
  /** 当前用户视图固定的 City 来源标签，仅用于记录，不授予权限。 */
  city_id?: string;
  /** Federation HTTP(S) 入口。 */
  url: string;

  /** 当前 User Token。 */
  user_token?: string;

  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
}

/** FederationAdmin 内部构造参数。 */
export interface FederationAdminOptions {
  /** Federation HTTP(S) 入口。 */
  url: string;

  /** 当前管理员 Session Token。 */
  admin_token?: string;

  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
}
