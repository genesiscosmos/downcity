/**
 * RemoteAgent transport 工厂。
 *
 * 关键点（中文）
 * - `RemoteAgent` 对外只接收 url，这里负责选择具体 transport。
 * - HTTP token 只传给 HTTP transport，RPC 不读取 token。
 */

import type { RemoteAgentTransport } from "@/remote/RemoteTransport.js";
import { HttpRemoteAgentTransport } from "@/remote/transports/HttpRemoteAgentTransport.js";
import { RpcRemoteAgentTransport } from "@/remote/transports/RpcRemoteAgentTransport.js";

/**
 * 根据 URL 协议创建远程 transport。
 */
export function create_remote_agent_transport(
  url: string,
  token?: string,
): RemoteAgentTransport {
  if (/^https?:\/\//i.test(url)) {
    return new HttpRemoteAgentTransport(url, token);
  }
  if (/^rpc:\/\//i.test(url)) {
    return new RpcRemoteAgentTransport(url);
  }
  throw new Error(
    `Unsupported RemoteAgent url protocol: ${url}. Expected http://, https://, or rpc://`,
  );
}
