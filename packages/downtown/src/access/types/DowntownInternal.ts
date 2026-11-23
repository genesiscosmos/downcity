/**
 * Downtown 内部构造依赖类型。
 */

import type { FetchLike } from "../../pact/http.js";
import type { ServiceClient } from "../../pact/invoker/invoker.js";

/** DowntownAccount 内部依赖。 */
export interface DowntownAccountOptions {
  /** 动态获取携带当前凭据的 Accounts Service 调用器，用于退出会话。 */
  accounts: () => ServiceClient;

  /** 获取不读取或携带用户凭据的 Accounts Service 调用器，用于公开登录流程。 */
  public_accounts: () => ServiceClient;

  /** 读取当前 Downtown User Token。 */
  read_user_token: () => string | undefined;

  /** 更新当前 Downtown User Token。 */
  update_user_token: (user_token: string | undefined) => void;
}

/** DowntownUser 内部构造参数。 */
export interface DowntownUserOptions {
  /** 宿主负责刷新并返回当前会话凭证；只在发送请求前调用。 */
  resolve_user_token?: (fetcher: FetchLike) => Promise<string>;
  /** 当前用户视图固定的 City 来源标签，仅用于记录，不授予权限。 */
  city_id?: string;
  /** Downtown HTTP(S) 入口。 */
  url: string;

  /** 当前 User Token。 */
  user_token?: string;

  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
}

/** DowntownAdmin 内部构造参数。 */
export interface DowntownAdminOptions {
  /** Downtown HTTP(S) 入口。 */
  url: string;

  /** 当前管理员 Session Token。 */
  admin_token?: string;

  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
}
