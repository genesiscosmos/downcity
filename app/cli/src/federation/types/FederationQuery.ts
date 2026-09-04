/**
 * Federation query 命令类型定义。
 *
 * 关键说明（中文）
 * - query 命令是面向排查的轻量 HTTP 客户端。
 * - 类型集中放在 types 目录，命令实现只负责解析、请求与输出。
 */

/**
 * Federation query 命令行参数。
 */
export interface FederationQueryCommandOptions {
  /** 是否输出服务端原始响应 body。 */
  raw?: boolean;
  /** 临时请求头，格式为 `key:value`，可重复传入。 */
  header?: string[];
  /** JSON 字符串请求体，来自 `--data` 或 `-d`。 */
  data?: string;
  /** 请求体文件路径，文件内容必须是 JSON。 */
  file?: string;
}

/**
 * 已解析完成、可直接发送的 Federation query 请求。
 */
export interface FederationQueryResolvedRequest {
  /** 标准化后的 HTTP method。 */
  method: string;
  /** 只允许指向当前 active Federation origin 的完整请求 URL。 */
  url: URL;
  /** 最终请求头集合；已登录管理员时包含 Authorization。 */
  headers: Headers;
  /** 已校验为 JSON 的请求 body；没有 body 时为 undefined。 */
  body?: string;
}
