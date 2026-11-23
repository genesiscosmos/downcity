/** City CLI Downtown 访问的命令参数与凭据快照。 */

/** 所有服务查询/调用共用的 CLI 参数。 */
export interface DowntownAccessOptions {
  /** 临时访问地址，不修改持久连接。 */
  url?: string;
  /** 持久连接 ID；与 --url 互斥，显式绑定一个 Downtown 来源。 */
  downtown_id?: string;
  /** 输出完整 JSON。SSE/非JSON响应仍按原始内容输出。 */
  json?: boolean;
  /** 使用目标已保存的管理员身份；不自动提权。 */
  admin?: boolean;
  /** 请求正文文件，- 表示stdin；JSON模式要求对象，raw模式保留原文。 */
  input?: string;
  /** OpenAPI输出文件；省略时输出stdout。 */
  output?: string;
}

/** 绑定一个已验证目标的凭据，不用于输出。 */
export interface DowntownAccessTarget {
  /** 不含userinfo、query、fragment的HTTP(S)基础地址。 */
  url: string;
  /** 持久连接 ID；临时环境来源没有此字段。 */
  downtown_id?: string;
  /** 与该目标匹配的用户凭据。 */
  user_token?: string;
  /** 共享用户会话ID，续期固定绑定该会话。 */
  session_id?: string;
  /** 与该目标匹配的管理员会话，仅显式admin时使用。 */
  admin_token?: string;
}
