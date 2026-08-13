/**
 * CLI City 进程组合根。
 *
 * 一个进程只创建一个 LocalCityStore 和一个 City，恢复全部已绑定 Agent，并拥有
 * 一个 HTTP Server 与一个 RPC Server。Agent 不拥有独立启动状态或端口。
 */

import { City, LocalCityStore } from "@downcity/city";
import type { CityDaemonOptions } from "@/city/process/daemon/Types.js";
import { createAgentHttpGatewayApp } from "@/city/agent/AgentHttpGateway.js";
import { AuthService } from "@/city/runtime/auth/AuthService.js";
import { create_cli_city_environment } from "@/city/runtime/LocalCityEnvironment.js";

/** 已启动的 CLI City Runtime。 */
export class ManagedCityRuntime {
  /** 当前进程唯一的 City。 */
  readonly city: City;
  /** 当前 City HTTP 端口。 */
  readonly http_port: number;
  /** 当前 City RPC 端口。 */
  readonly rpc_port: number;

  private stopped = false;

  private constructor(input: {
    /** 当前 City。 */
    city: City;
    /** HTTP 端口。 */
    http_port: number;
    /** RPC 端口。 */
    rpc_port: number;
  }) {
    this.city = input.city;
    this.http_port = input.http_port;
    this.rpc_port = input.rpc_port;
  }

  /** 按依赖逆序幂等释放全部宿主资源。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.city.dispose();
  }

  /** 从全局 Store 创建并启动完整 CLI City Runtime。 */
  static async start(options: CityDaemonOptions): Promise<ManagedCityRuntime> {
    const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
    const http_port = options.http_port ?? 5314;
    const rpc_port = options.rpc_port ?? 15314;
    if (http_port === rpc_port) throw new Error("City HTTP and RPC ports must be different");

    const store = new LocalCityStore();
    const environment = create_cli_city_environment({
      host,
      port: http_port,
      data_source: store,
    });
    const city = new City(store, environment, {
      http: {
        resolve_session_model: async (agent_id, model_id) =>
          await environment.resolve_model(
            model_id,
            city.require_agent(agent_id).workspace.get_env(),
          ),
        create_agent_extension: ({ agent, sdk_router }) => {
          const auth_service = new AuthService({ agent_id: agent.id });
          return {
            router: createAgentHttpGatewayApp({
              get_agent: () => agent,
              sdkRouter: sdk_router,
              auth_service,
            }),
            dispose: () => auth_service.close(),
          };
        },
      },
      rpc: {
        resolve_session_model: async (agent_id, model_id) =>
          await environment.resolve_model(
            model_id,
            city.require_agent(agent_id).workspace.get_env(),
          ),
        reload_workspace_env: (agent_id) => {
          const agent = city.require_agent(agent_id);
          const env = environment.reload_workspace_env(agent.workspace.path);
          agent.workspace.set_env(env);
          return env;
        },
      },
    });

    process.env.DC_CITY_HOST = host;
    process.env.DC_CITY_PORT = String(http_port);
    process.env.DC_CITY_RPC_HOST = "127.0.0.1";
    process.env.DC_CITY_RPC_PORT = String(rpc_port);

    try {
      await city.listen({
        rpc: { host: "127.0.0.1", port: rpc_port },
        http: { host, port: http_port },
      });
      return new ManagedCityRuntime({ city, http_port, rpc_port });
    } catch (error) {
      await city.dispose().catch(() => undefined);
      throw error;
    }
  }
}
