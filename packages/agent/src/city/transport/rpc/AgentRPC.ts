/**
 * AgentRPC：把本地 Agent 暴露为本机 RPC 服务的对外类。
 *
 * 关键点（中文）
 * - 持有一个 `Agent` 引用，按需启动 / 关闭底层 net server。
 * - RPC 协议本身仍是 NDJSON over TCP，不做协议变更。
 * - 仅提供 `listen()` / `close()` / `binding()` 三个方法，端口、host 由调用方决定。
 */

import type { AgentWorkspace } from "@/internal/index.js";
import { create_agent_workspace } from "@/internal/index.js";
import type { Agent } from "@/agent/Agent.js";
import type { AgentSessionCollection } from "@/types/agent/AgentSessionCollection.js";
import type { WorkspaceBase } from "@downcity/workspace";
import { start_rpc_server, type RpcServerInstance } from "@/city/transport/rpc/RpcServer.js";
import type {
  AgentRpcBinding,
  AgentRpcListenOptions,
} from "@/city/transport/types/AgentRpcBinding.js";
import type { AgentRpcRuntimeOptions } from "@/city/transport/types/AgentRpcRuntime.js";
import { SerializedTransport } from "@/city/transport/SerializedTransport.js";

const DEFAULT_RPC_HOST = "127.0.0.1";
const DEFAULT_RPC_PORT = 15314;

/**
 * 把一个 `Agent` 暴露为本机 RPC 服务。
 */
export class AgentRPC {
  private readonly agent_workspace: AgentWorkspace;
  private readonly session_collection: AgentSessionCollection;
  private readonly runtime_options: AgentRpcRuntimeOptions;
  /** 当前 Agent RPC Server 的唯一串行生命周期。 */
  private readonly lifecycle: SerializedTransport<
    AgentRpcListenOptions | undefined,
    RpcServerInstance,
    AgentRpcBinding
  >;

  constructor(
    agent_or_workspace: Agent | AgentWorkspace,
    workspace_or_options?: WorkspaceBase | AgentRpcRuntimeOptions,
    runtime_options: AgentRpcRuntimeOptions = {},
  ) {
    if (workspace_or_options && "id" in workspace_or_options && "path" in workspace_or_options) {
      this.agent_workspace = create_agent_workspace(agent_or_workspace as Agent, workspace_or_options);
      const agent = agent_or_workspace as Agent;
      this.session_collection = {
        ...agent.sessions,
        create: async () => await agent.sessions.create({ workspace: this.agent_workspace.workspace }),
        get: async (session_id) => await agent.sessions.get(session_id, { workspace: this.agent_workspace.workspace }),
      };
      this.runtime_options = runtime_options;
    } else {
      this.agent_workspace = agent_or_workspace as AgentWorkspace;
      const agent = this.agent_workspace.agent;
      this.session_collection = {
        ...agent.sessions,
        create: async () => await agent.sessions.create({ workspace: this.agent_workspace.workspace }),
        get: async (session_id) => await agent.sessions.get(session_id, { workspace: this.agent_workspace.workspace }),
      };
      this.runtime_options = (workspace_or_options as AgentRpcRuntimeOptions | undefined) ?? {};
    }
    this.lifecycle = new SerializedTransport({
      start: async (options) => {
        const host = String(options?.host || DEFAULT_RPC_HOST).trim() || DEFAULT_RPC_HOST;
        const port = typeof options?.port === "number" && Number.isInteger(options.port)
          ? options.port
          : DEFAULT_RPC_PORT;
        const instance = await start_rpc_server({
          host,
          port,
          sessions: this.session_collection,
          get_workspace: () => this.agent_workspace,
          resolve_session_model: this.runtime_options.resolve_session_model,
          reload_workspace_env: this.runtime_options.reload_workspace_env,
        });
        return {
          resource: instance,
          binding: { url: instance.url, host: instance.host, port: instance.port },
        };
      },
      stop: async (instance) => await instance.stop(),
    });
  }

  /**
   * 监听 RPC 端口。
   *
   * 说明（中文）
   * - 重复调用返回同一个 binding。
   * - 默认 `127.0.0.1:15314`，本机调试足够。
   */
  async listen(options?: AgentRpcListenOptions): Promise<AgentRpcBinding> {
    return await this.lifecycle.listen(options);
  }

  /**
   * 关闭 RPC 服务。
   */
  async close(): Promise<void> {
    await this.lifecycle.close();
  }

  /**
   * 当前监听绑定信息，未 listen 时返回 `null`。
   */
  binding(): AgentRpcBinding | null {
    return this.lifecycle.binding();
  }
}
