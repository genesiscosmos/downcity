/**
 * City 用户客户端构造类型模块。
 *
 * City 只表达 Agent 终端。登录前只连接 Federation；登录后由 Federation
 * 验证 User Token 并解析当前 Bureau 与服务端入口。
 */

import type { FetchLike } from "../pact/http.js";

/** City 用户客户端构造参数。 */
export interface CityOptions {
  /** Federation 的 HTTP 入口地址。 */
  federation_url: string;

  /**
   * Federation 签发的终端用户 token。
   *
   * 访问 accounts 登录等公开 Action 时可以省略；受保护操作必须提供。
   */
  user_token?: string;

  /** 自定义 fetch 实现。 */
  fetch?: FetchLike;
}
