/**
 * CityHTTP：在一个 HTTP Server 上暴露 City 持有的全部 Agent。
 *
 * 每个 Agent 固定挂载到 `/agents/<agent_id>`。调用方可以直接把该地址交给
 * `RemoteAgent`，transport 只负责路由，不复制 Agent 或 Session 状态。
 */

import { Hono } from "hono";
import type { City } from "@/runtime/City.js";
import {
  AgentHTTP,
  create_agent_http_server_handle,
  type AgentHttpServerHandle,
} from "@/transport/http/AgentHTTP.js";
import type { CityHttpRuntimeOptions } from "@/transport/types/CityHttpRuntime.js";

/** 在单一 HTTP 端口暴露 City 的多 Agent transport。 */
export class CityHTTP {
  private readonly city: City;
  private readonly runtime_options: CityHttpRuntimeOptions;
  private readonly agent_http_instances: AgentHTTP[] = [];
  private cached_router: Hono | null = null;
  private cached_server: AgentHttpServerHandle | null = null;

  constructor(city: City, runtime_options: CityHttpRuntimeOptions = {}) {
    this.city = city;
    this.runtime_options = runtime_options;
  }

  /** 返回按 Agent ID 分区的 Hono Router。 */
  router(): Hono {
    if (this.cached_router) return this.cached_router;
    const root = new Hono();
    for (const agent of this.city.agents()) {
      const resolve_session_model = this.runtime_options.resolve_session_model;
      const agent_http = new AgentHTTP(agent, {
        resolve_session_model: resolve_session_model
          ? async (model_id) => await resolve_session_model(
              agent.id,
              model_id,
            )
          : undefined,
      });
      this.agent_http_instances.push(agent_http);
      root.route(`/agents/${encodeURIComponent(agent.id)}`, agent_http.router());
    }
    this.cached_router = root;
    return root;
  }

  /** 返回 City 级 HTTP Server 句柄。 */
  server(): AgentHttpServerHandle {
    if (this.cached_server) return this.cached_server;
    this.cached_server = create_agent_http_server_handle(this.router());
    return this.cached_server;
  }

  /** 幂等关闭独立启动的 HTTP Server。 */
  async close(): Promise<void> {
    const server = this.cached_server;
    this.cached_server = null;
    if (server) await server.close();
  }
}
