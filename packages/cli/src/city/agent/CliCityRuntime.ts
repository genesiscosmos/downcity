/**
 * CLI City 进程组合根。
 *
 * CLI 显式读取本地配置并创建 Agent；City 只索引这些实例并提供一个 HTTP Server
 * 与一个 RPC Server。Agent 不拥有独立端口。
 */

import { Agent } from "@downcity/agent";
import {
  City,
  create_city_host_instance_id,
  register_city_host,
  unregister_city_host,
} from "@downcity/city";
import type { CityDaemonOptions } from "@/city/process/daemon/Types.js";
import { create_agent_http_gateway_app } from "@/city/agent/AgentHttpGateway.js";
import { AuthService } from "@/city/runtime/auth/AuthService.js";
import {
  create_cli_agent,
  create_cli_workspace,
  create_cli_plugin_loader,
  reload_cli_workspace_env,
  resolve_cli_agent_model,
} from "@/city/runtime/AgentAssembly.js";
import { create_cli_local_data, type CliLocalData } from "@/city/runtime/LocalData.js";

/** 已启动的 CLI City Runtime。 */
export class CliCityRuntime {
  /** 当前进程唯一的 City。 */
  readonly city: City;
  /** 当前 City HTTP 端口。 */
  readonly http_port: number;
  /** 当前 City RPC 端口。 */
  readonly rpc_port: number;

  /** CLI 宿主创建并拥有的全部 Agent。 */
  private readonly agents: readonly Agent[];

  /** CLI 宿主拥有的本地数据库和 Repository。 */
  private readonly data: CliLocalData;
  private readonly host_instance_id: string;

  private stopped = false;

  private constructor(input: {
    /** 当前 City。 */
    city: City;
    /** HTTP 端口。 */
    http_port: number;
    /** RPC 端口。 */
    rpc_port: number;
    /** CLI 宿主创建的全部 Agent。 */
    agents: readonly Agent[];
    /** CLI 宿主使用的本地产品数据。 */
    data: CliLocalData;
    host_instance_id: string;
  }) {
    this.city = input.city;
    this.http_port = input.http_port;
    this.rpc_port = input.rpc_port;
    this.agents = input.agents;
    this.data = input.data;
    this.host_instance_id = input.host_instance_id;
  }

  /** 按依赖逆序幂等释放全部宿主资源。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const results: PromiseSettledResult<unknown>[] = [];
    results.push(...await Promise.allSettled([this.city.close()]));
    results.push(...await Promise.allSettled(
      this.agents.map(async (agent) => await agent.dispose()),
    ));
    results.push(...await Promise.allSettled([
      Promise.resolve().then(() => this.data.database.close()),
      unregister_city_host(this.host_instance_id),
    ]));
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "CLI City stop failed");
  }

  /** 从本地产品配置创建并启动完整 CLI City Runtime。 */
  static async start(options: CityDaemonOptions): Promise<CliCityRuntime> {
    const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
    const http_port = options.http_port ?? 5314;
    const rpc_port = options.rpc_port ?? 15314;
    if (http_port === rpc_port) throw new Error("City HTTP and RPC ports must be different");

    const data = create_cli_local_data();
    const plugin_loader = create_cli_plugin_loader({
      host,
      port: http_port,
      plugin_repository: data.plugins,
    });
    const city = new City({ runtime: {
      resolve_workspace: async (_agent, workspace_id) => {
        const workspace_config = data.workspaces.get(workspace_id);
        if (!workspace_config) throw new Error(`Workspace not found: ${workspace_id}`);
        return await create_cli_workspace(workspace_config, data.root_path);
      },
      http: {
        resolve_session_model: async (agent_id, workspace_id, model_id) =>
          await resolve_cli_agent_model(
            model_id,
            (await city.enter_workspace(agent_id, workspace_id)).workspace.get_env(),
          ),
        create_agent_extension: ({ agent, agent_workspace, sdk_router }) => {
          const auth_service = new AuthService({
            agent_id: agent.id,
            repository: data.agent_tokens,
          });
          return {
            router: create_agent_http_gateway_app({
              get_agent: () => agent_workspace,
              sdk_router,
              auth_service,
            }),
            dispose: () => auth_service.close(),
          };
        },
      },
      rpc: {
        shutdown: () => { process.kill(process.pid, "SIGTERM"); },
        resolve_session_model: async (agent_id, workspace_id, model_id) =>
          await resolve_cli_agent_model(
            model_id,
            (await city.enter_workspace(agent_id, workspace_id)).workspace.get_env(),
          ),
        reload_workspace_env: async (agent_id, workspace_id) => {
          const entry = await city.enter_workspace(agent_id, workspace_id);
          const env = reload_cli_workspace_env(entry.workspace.path, data.root_path);
          entry.workspace.set_env(env);
          return env;
        },
      },
    }});
    const agents: Agent[] = [];
    try {
      for (const config of data.agents.list()) {
        agents.push(await create_cli_agent({
          config,
          plugin_loader,
          city,
        }));
      }
    } catch (error) {
      await Promise.allSettled(agents.map(async (agent) => await agent.dispose()));
      data.database.close();
      throw error;
    }
    process.env.DC_CITY_HOST = host;
    process.env.DC_CITY_PORT = String(http_port);
    process.env.DC_CITY_RPC_HOST = "127.0.0.1";
    process.env.DC_CITY_RPC_PORT = String(rpc_port);

    try {
      await city.listen({
        rpc: { host: "127.0.0.1", port: rpc_port },
        http: { host, port: http_port },
      });
      const host_instance_id = String(process.env.DOWNCITY_DAEMON_INSTANCE_ID || "").trim()
        || create_city_host_instance_id();
      await register_city_host({
        owner: "cli",
        pid: process.pid,
        instance_id: host_instance_id,
        started_at: new Date().toISOString(),
        http_host: host,
        http_port,
        rpc_host: "127.0.0.1",
        rpc_port,
      });
      return new CliCityRuntime({ city, http_port, rpc_port, agents, data, host_instance_id });
    } catch (error) {
      await city.close().catch(() => undefined);
      await Promise.allSettled(agents.map(async (agent) => await agent.dispose()));
      data.database.close();
      throw error;
    }
  }
}
