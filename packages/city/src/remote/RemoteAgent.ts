/**
 * Node RemoteAgent 入口：按 URL 选择 HTTP 或 RPC。
 * 会话门面与执行生命周期由跨平台 RemoteAgentCore 统一持有。
 */
import type { RemoteAgentOptions } from "@/types/remote/RemoteAgentOptions.js";
import { RemoteAgentCore } from "./RemoteAgentCore.js";
import { create_remote_agent_transport } from "./TransportFactory.js";

/** 支持 HTTP、HTTPS 和本机 RPC 的远程 SDK。 */
export class RemoteAgent extends RemoteAgentCore {
  constructor(options: RemoteAgentOptions) {
    const url = String(options.url || "").trim();
    if (!url) throw new Error("RemoteAgent requires a non-empty url");
    super(create_remote_agent_transport(url, options.token));
  }
}
