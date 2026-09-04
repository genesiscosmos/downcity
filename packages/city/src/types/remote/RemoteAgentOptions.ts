/**
 * RemoteAgent 构造类型。
 *
 * 关键点（中文）
 * - RemoteAgent 只关心远程访问地址与可选鉴权 token。
 * - HTTP 鉴权与 RPC 本机直连语义在 transport 层实现。
 */

/**
 * 远程 Agent 构造参数。
 */
export interface RemoteAgentOptions {
  /**
   * 远程 agent 访问地址。
   *
   * 例如：`https://city.example.com/agents/lucas`、`http://127.0.0.1:5314/agents/lucas`
   * 或 `rpc://127.0.0.1:15314/lucas`
   */
  url: string;

  /**
   * 访问远程 HTTP Agent 时使用的 Bearer token。
   *
   * 关键点（中文）
   * - 仅 `http://` / `https://` transport 会携带该 token。
   * - `rpc://` 是本机内部直连通道，不读取也不发送 token。
   */
  token?: string;
}
