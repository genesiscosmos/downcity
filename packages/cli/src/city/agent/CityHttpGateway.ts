/**
 * CLI City 多 Agent HTTP Gateway。
 *
 * 每个 Agent 的鉴权、控制、Plugin、Execute 与 RemoteAgent SDK 路由完整挂载到
 * `/agents/<agent_id>`。Gateway 只拥有网络与 AuthService 生命周期。
 */

import http from "node:http";
import { Hono } from "hono";
import type { City, LocalCityStore } from "@downcity/city";
import { AgentHTTP } from "@downcity/city";
import {
  createAgentHttpGatewayApp,
  create_node_http_server,
} from "@/city/agent/AgentHttpGateway.js";
import { AuthService } from "@/city/runtime/auth/AuthService.js";

/** 已启动的 CLI City HTTP Gateway。 */
export interface CityHttpGatewayInstance {
  /** Hono 根应用。 */
  app: Hono;
  /** Node HTTP Server。 */
  server: http.Server;
  /** 幂等停止 Gateway。 */
  stop(): Promise<void>;
}

/** 启动一个按 Agent ID 分区的 City HTTP Gateway。 */
export async function start_city_http_gateway(input: {
  /** 当前 City。 */
  city: City;
  /** City 使用的本地 Store。 */
  store: LocalCityStore;
  /** HTTP 监听地址。 */
  host: string;
  /** HTTP 端口。 */
  port: number;
}): Promise<CityHttpGatewayInstance> {
  const app = new Hono();
  const auth_services: AuthService[] = [];
  for (const agent of input.city.agents()) {
    const auth_service = new AuthService({ agent_id: agent.id });
    auth_services.push(auth_service);
    const agent_http = new AgentHTTP(agent, {
      resolve_session_model: async (model_id) => await input.store.create_model(model_id),
    });
    const agent_app = createAgentHttpGatewayApp({
      get_agent: () => agent,
      sdkRouter: agent_http.router(),
      auth_service,
    });
    app.route(`/agents/${encodeURIComponent(agent.id)}`, agent_app);
  }
  app.get("/internal/status", (context) => context.json({
    success: true,
    status: "ok",
    pid: process.pid,
    agent_ids: input.city.agents().map((agent) => agent.id),
  }));

  const server = create_node_http_server(app, {
    host: input.host,
    port: input.port,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, input.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    for (const service of auth_services) service.close();
    throw error;
  }
  return {
    app,
    server,
    async stop(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const service of auth_services) service.close();
    },
  };
}
