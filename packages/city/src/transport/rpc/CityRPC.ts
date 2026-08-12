/**
 * CityRPC：在一个原生 TCP RPC Server 上暴露 City 持有的全部 Agent。
 *
 * 请求必须携带 `agent_id`。`RemoteAgent` 会从
 * `rpc://host:port/<agent_id>` 自动解析并附加该字段。
 */

import type { AgentSessions } from "@downcity/agent";
import type { City } from "@/runtime/City.js";
import { startRpcServer, type RpcServerInstance } from "@/transport/rpc/RpcServer.js";
import type {
  AgentRpcBinding,
  AgentRpcListenOptions,
} from "@/transport/types/AgentRpcBinding.js";
import type { CityRpcRuntimeOptions } from "@/transport/types/CityRpcRuntime.js";

const DEFAULT_RPC_HOST = "127.0.0.1";
const DEFAULT_RPC_PORT = 15314;

/** 在单一 RPC 端口暴露 City 的多 Agent transport。 */
export class CityRPC {
  private readonly city: City;
  private readonly runtime_options: CityRpcRuntimeOptions;
  private rpc_instance: RpcServerInstance | null = null;
  private current_binding: AgentRpcBinding | null = null;
  private start_promise: Promise<AgentRpcBinding> | null = null;

  constructor(city: City, runtime_options: CityRpcRuntimeOptions = {}) {
    this.city = city;
    this.runtime_options = runtime_options;
  }

  /** 监听 City 级 RPC 端口。 */
  async listen(options?: AgentRpcListenOptions): Promise<AgentRpcBinding> {
    if (this.start_promise) return await this.start_promise;
    if (this.current_binding) return this.current_binding;
    this.start_promise = (async () => {
      const host = String(options?.host || DEFAULT_RPC_HOST).trim() || DEFAULT_RPC_HOST;
      const port = Number.isInteger(options?.port) ? Number(options?.port) : DEFAULT_RPC_PORT;
      const fallback_agent = this.city.agents()[0];
      const unavailable_sessions = create_unavailable_sessions();
      const instance = await startRpcServer({
        host,
        port,
        sessions: fallback_agent?.sessions ?? unavailable_sessions,
        resolve_request_options: (request) => {
          if (request.method === "internal.city.status") {
            return {
              sessions: fallback_agent?.sessions ?? unavailable_sessions,
              get_city_status: () => ({
                agent_ids: this.city.agents().map((agent) => agent.id),
              }),
            };
          }
          const agent_id = String(request.agent_id || "").trim();
          if (!agent_id) throw new Error("CityRPC request requires agent_id");
          const agent = this.city.require_agent(agent_id);
          const resolve_session_model = this.runtime_options.resolve_session_model;
          const reload_workspace_env = this.runtime_options.reload_workspace_env;
          return {
            sessions: agent.sessions,
            get_agent: () => agent,
            resolve_session_model: resolve_session_model
              ? async (model_id) => await resolve_session_model(
                  agent_id,
                  model_id,
                )
              : undefined,
            reload_workspace_env: reload_workspace_env
              ? async () => await reload_workspace_env(agent_id)
              : undefined,
          };
        },
      });
      this.rpc_instance = instance;
      this.current_binding = { url: instance.url, host: instance.host, port: instance.port };
      return this.current_binding;
    })();
    try {
      return await this.start_promise;
    } finally {
      this.start_promise = null;
    }
  }

  /** 幂等关闭 RPC Server 与全部长连接。 */
  async close(): Promise<void> {
    const instance = this.rpc_instance;
    this.rpc_instance = null;
    this.current_binding = null;
    if (instance) await instance.stop();
  }

  /** 返回当前绑定；尚未监听时返回 null。 */
  binding(): AgentRpcBinding | null {
    return this.current_binding;
  }
}

/** 空 City 中拒绝 Agent SDK 请求的 Session 集合。 */
function create_unavailable_sessions(): AgentSessions {
  const unavailable = async (): Promise<never> => {
    throw new Error("City has no Agents");
  };
  return {
    create: unavailable,
    get: unavailable,
    list: unavailable,
    archive: unavailable,
    archived: unavailable,
    clean_archive: unavailable,
  };
}
