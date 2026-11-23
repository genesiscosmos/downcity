/** Service 原始响应请求契约；身份由所属 Federation user/admin 访问器注入。 */
import type { RequestInitLike } from "../pact/http.js";

/** 按指定 HTTP 方法调用 action，保留响应流和媒体类型。 */
export interface ServiceRequestOptions {
  /** 已注册 action 的 HTTP 方法，默认 POST。 */
  method?: "GET" | "POST";
  /** GET 的 query 参数；null/undefined省略，其余值转换为字符串。 */
  query?: Record<string, unknown>;
  /** POST 的原始文本正文；JSON请求由调用者序列化。 */
  body?: string;
  /** 请求头；身份仍由访问器解析并覆盖，不能借此更换用户。 */
  headers?: RequestInitLike["headers"];
  /** 取消请求以及响应读取的信号。 */
  signal?: AbortSignal;
}
