/**
 * AgentRPC：把本地 Agent 暴露为本机 RPC 服务的对外类。
 *
 * 关键点（中文）
 * - 持有一个 `Agent` 引用，按需启动 / 关闭底层 net server。
 * - RPC 协议本身仍是 NDJSON over TCP，不做协议变更。
 * - 仅提供 `listen()` / `close()` / `binding()` 三个方法，端口、host 由调用方决定。
 */

import type { Agent } from "@downcity/agent";
import { startRpcServer, type RpcServerInstance } from "@/transport/rpc/RpcServer.js";
import type {
  AgentRpcBinding,
  AgentRpcListenOptions,
} from "@/transport/types/AgentRpcBinding.js";
import type { AgentRpcRuntimeOptions } from "@/transport/types/AgentRpcRuntime.js";

const DEFAULT_RPC_HOST = "127.0.0.1";
const DEFAULT_RPC_PORT = 15314;

/**
 * 把一个 `Agent` 暴露为本机 RPC 服务。
 */
export class AgentRPC {
  private readonly agent: Agent;
  private readonly runtime_options: AgentRpcRuntimeOptions;
  private rpc_instance: RpcServerInstance | null = null;
  private current_binding: AgentRpcBinding | null = null;
  private start_promise: Promise<AgentRpcBinding> | null = null;

  constructor(agent: Agent, runtime_options: AgentRpcRuntimeOptions = {}) {
    this.agent = agent;
    this.runtime_options = runtime_options;
  }

  /**
   * 监听 RPC 端口。
   *
   * 说明（中文）
   * - 重复调用返回同一个 binding。
   * - 默认 `127.0.0.1:15314`，本机调试足够。
   */
  async listen(options?: AgentRpcListenOptions): Promise<AgentRpcBinding> {
    if (this.start_promise) return await this.start_promise;
    if (this.current_binding) return this.current_binding;
    this.start_promise = (async () => {
      const host =
        String(options?.host || DEFAULT_RPC_HOST).trim() || DEFAULT_RPC_HOST;
      const port =
        typeof options?.port === "number" && Number.isInteger(options.port)
          ? options.port
          : DEFAULT_RPC_PORT;
      const instance = await startRpcServer({
        host,
        port,
        sessions: this.agent.sessions,
        get_agent: () => this.agent,
        resolve_session_model: this.runtime_options.resolve_session_model,
        reload_workspace_env: this.runtime_options.reload_workspace_env,
      });
      this.rpc_instance = instance;
      this.current_binding = {
        url: instance.url,
        host: instance.host,
        port: instance.port,
      };
      return this.current_binding;
    })();
    try {
      return await this.start_promise;
    } finally {
      this.start_promise = null;
    }
  }

  /**
   * 关闭 RPC 服务。
   */
  async close(): Promise<void> {
    const instance = this.rpc_instance;
    this.rpc_instance = null;
    this.current_binding = null;
    if (!instance) return;
    await instance.stop();
  }

  /**
   * 当前监听绑定信息，未 listen 时返回 `null`。
   */
  binding(): AgentRpcBinding | null {
    return this.current_binding;
  }
}
