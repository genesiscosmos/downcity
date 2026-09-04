/**
 * Chat Access Control API 请求类型。
 */

/** Access Request 处理请求体。 */
export interface ChatAccessResolveRequestBody {
  /** 可选范围覆盖；缺省时使用 Request 自身范围。 */
  scope?: "direct" | "group" | "all";
}

/** Principal Grant 设置请求体。 */
export interface ChatAccessSetGrantBody {
  /** 要设置的消息范围。 */
  scope?: "direct" | "group" | "all";
  /** 要写入的准入效果。 */
  effect?: "allow" | "deny";
}

/** Principal Grant 撤销请求体。 */
export interface ChatAccessRevokeGrantBody {
  /** 要撤销的消息范围。 */
  scope?: "direct" | "group" | "all";
}

/** 读取 Hono Context 变量的最小接口。 */
export interface ChatAccessControlContextReader {
  /** 按 Context key 读取由鉴权中间件写入的值。 */
  get?: (key: string) => unknown;
}
