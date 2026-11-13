/**
 * CLI City 进程组合根。
 *
 * CLI 显式读取本地配置并创建 Agent；City 只索引这些实例并提供一个 HTTP Server
 * 与一个 RPC Server。Agent 不拥有独立端口。
 */

import { Agent } from "@downcity/agent";
import { City } from "@downcity/city";
import { LocalStorageProvider } from "@downcity/city";
import {
  create_city_host_instance_id,
  register_city_host,
  unregister_city_host,
} from "@downcity/city";
import { FederationSessionResolver } from "@/city/shared/FederationSessionResolver.js";
import type { CityDaemonOptions } from "@/city/process/daemon/Types.js";
import { create_agent_http_gateway_app } from "@/city/agent/AgentHttpGateway.js";
import { AuthService } from "@/city/runtime/auth/AuthService.js";
import {
  create_cli_agent,
  create_cli_workspace,
  create_cli_power_loader,
  reload_cli_workspace_env,
  resolve_cli_agent_model,
} from "@/city/runtime/AgentAssembly.js";
import { resolve_local_city_id, RootLease, resolve_resource_root, ResourceCoordinator, ManagementChannel, MANAGEMENT_VERSION, get_root_identity, assert_session_storage_ready, type ResourceService } from "@downcity/city/local";
import { read_city_host_state } from "@downcity/city";
import { create_cli_resources } from "../resources/CliResources.js";
import { create_cli_local_data, type CliLocalData } from "@/city/runtime/LocalData.js";

/** 已启动的 CLI City Runtime。 */
export class CliCityRuntime {
  /** 当前进程唯一的 City。 */
  readonly city: City;
  /** 当前 City HTTP 端口。 */
  readonly http_port: number;
  /** 当前 City RPC 端口。 */
  readonly rpc_port: number;

  /** CLI 宿主拥有的本地数据库和 Repository。 */
  private readonly data: CliLocalData;
  private readonly host_instance_id: string;
  /** 从打开业务 DB 之前持有，最后一个业务连接关闭之后释放。 */
  private readonly lease: RootLease;
  /** 本机用户管理监听；与公开 HTTP 独立。 */
  private readonly management: ManagementChannel;
  /** CLI/TUI/Desktop 共用业务服务的本宿主实例。 */
  private readonly resources: ResourceService;

  private stopped = false;

  private constructor(input: {
    /** 当前 City。 */
    city: City;
    /** HTTP 端口。 */
    http_port: number;
    /** RPC 端口。 */
    rpc_port: number;
    /** CLI 宿主使用的本地产品数据。 */
    data: CliLocalData;
    /** 宿主唯一实例身份。 */
    host_instance_id: string;
    /** root 独占租约。 */
    lease: RootLease;
    /** 管理通道监听。 */
    management: ManagementChannel;
    /** 资源业务服务。 */
    resources: ResourceService;
  }) {
    this.city = input.city;
    this.http_port = input.http_port;
    this.rpc_port = input.rpc_port;
    this.data = input.data;
    this.host_instance_id = input.host_instance_id;
    this.lease = input.lease;
    this.management = input.management;
    this.resources = input.resources;
  }

  /** 按依赖逆序幂等释放全部宿主资源。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const results: PromiseSettledResult<unknown>[] = [];
    results.push(...await Promise.allSettled([this.management.close()]));
    results.push(...await Promise.allSettled([this.resources.dispose()]));
    results.push(...await Promise.allSettled([this.city.close()]));
    const federation = this.city.federation.current;
    this.city.federation.set(undefined);
    results.push(...await Promise.allSettled([federation?.dispose()]));
    results.push(...await Promise.allSettled([
      Promise.resolve().then(() => this.data.database.close()),
      unregister_city_host(this.host_instance_id, this.data.root_path),
    ]));
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "CLI City stop failed");
    this.lease.release();
  }

  /** 从本地产品配置创建并启动完整 CLI City Runtime。 */
  static async start(options: CityDaemonOptions): Promise<CliCityRuntime> {
    const root_path = resolve_resource_root();
    if (await read_city_host_state(root_path)) throw new Error("A City host already owns this root");
    const lease = RootLease.acquire_write(root_path);
    let data: CliLocalData | undefined;
    try {
      await assert_session_storage_ready(root_path);
      data = create_cli_local_data(root_path);
      data.agents.recover_pending_commits();
      return await CliCityRuntime.start_owned(options, data, lease);
    } catch (error) { data?.database.close(); lease.release(); throw error; }
  }

  /** root 已互斥，才允许打开 DB、装配/迁移以及恢复工作。 */
  private static async start_owned(options: CityDaemonOptions, data: CliLocalData, lease: RootLease): Promise<CliCityRuntime> {
    const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
    const http_port = options.http_port ?? 5314;
    const rpc_port = options.rpc_port ?? 15314;
    if (http_port === rpc_port) throw new Error("City HTTP and RPC ports must be different");

    const root_path = data.root_path;
    const coordinator = new ResourceCoordinator();
    let resources: ResourceService;
    const host_instance_id = String(process.env.DOWNCITY_DAEMON_INSTANCE_ID || "").trim() || create_city_host_instance_id();
    const power_loader = create_cli_power_loader({
      power_repository: data.powers,
    });
    const power_registrations = await power_loader.list_registrations();
    // 宿主从已存身份离线构建客户端；没有 Token 也能启动本地 City。
    const federation = await new FederationSessionResolver().create_runtime_client().catch((error: unknown) => {
      // 只隔离远端配置解析错误；数据库与文件系统错误仍按本地故障上抛。
      if (!(error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError)) throw error;
      // 不输出原始异常、URL 或 Token，避免损坏配置将凭据带入日志。
      console.warn("[Federation] Saved binding configuration is invalid. City will start without a Federation binding; review the selected Federation configuration.");
      return undefined;
    });
    const city = new City({
      city_id: resolve_local_city_id(root_path),
      storage: new LocalStorageProvider(data.root_path),
      federation,
      powers: power_registrations,
      power_host: {
        config: (power_id) => ({
          path: data.powers.config_path(power_id),
          get: () => structuredClone(data.powers.get_config(power_id)),
          set: async (config) => {
            await coordinator.mutate(() => data.powers.set_config(power_id, structuredClone(config)));
          },
        }),
      },
      runtime: {
        assert_resource_access: (agent_id, workspace_id) => coordinator.assert_available(agent_id, workspace_id),
        create_agent: async (input) => {
          const result = await resources.agents.create({ name: input.name, description: input.description, instruction: input.instruction, model: input.model_id });
          return city.agents.get(result.agent.agent_id)!;
        },
        resolve_workspace: async (_agent, workspace_id) => {
        coordinator.assert_available(_agent.id, workspace_id);
        const workspace_config = data.workspaces.get(workspace_id);
        if (!workspace_config) throw new Error(`Workspace not found: ${workspace_id}`);
        return await create_cli_workspace(workspace_config, data.root_path);
      },
      http: {
        authorize_agent: ({ agent, request }) => {
          const auth = new AuthService({ agent_id: agent.id, repository: data.city_tokens });
          try {
            auth.authenticate_bearer_header(request.headers.get("authorization") ?? undefined);
            return true;
          } catch { return false; }
          finally { auth.close(); }
        },
        resolve_session_model: async ({ model_id }) =>
          await resolve_cli_agent_model(model_id, () => city.federation.current),
        create_agent_extension: ({ agent, workspace, powers, sdk_router }) => {
          const auth_service = new AuthService({
            agent_id: agent.id,
            repository: data.city_tokens,
          });
          const data_path = city.storage.open_scope(["agents", agent.id]).root_path;
          return {
            router: create_agent_http_gateway_app({
              get_context: () => ({
                agent,
                workspace,
                workspace_id: workspace.id,
                data_path,
                sessions: agent.sessions,
                powers,
                id: agent.id,
                list_power_states: () => city.powers.snapshots(),
                resolve_system_messages: (input) =>
                  agent.resolve_system_messages(workspace, input),
                register_power_http_routes: (app) => {
                  city.powers.register_http_routes(app, {
                    agent_id: agent.id,
                    workspace_id: workspace.id,
                  });
                },
              }),
              sdk_router,
              auth_service,
            }),
            dispose: () => auth_service.close(),
          };
        },
      },
      rpc: {
        instance_id: host_instance_id,
        shutdown: () => { process.kill(process.pid, "SIGTERM"); },
        resolve_session_model: async ({ model_id }) =>
          await resolve_cli_agent_model(model_id, () => city.federation.current),
        reload_workspace_env: async ({ workspace }) => {
          const env = reload_cli_workspace_env(workspace.path, data.root_path);
          workspace.set_env(env);
          return env;
        },
      },
      },
    });
    resources = create_cli_resources(data, city, coordinator);
    const agents: Agent[] = [];
    try {
      for (const config of data.agents.list()) {
        const agent = await create_cli_agent({
          config,
          resolve_federation: () => city.federation.current,
        });
        agents.push(agent);
        city.agents.add(agent);
      }
      await Promise.all(agents.map(async (agent) => await agent.resume_work()));
    } catch (error) {
      await Promise.allSettled(agents.map(async (agent) => await city.agents.remove(agent.id)));
      await resources.dispose().catch(() => undefined);
      await city.close().catch(() => undefined);
      city.federation.set(undefined);
      await federation?.dispose().catch(() => undefined);
      data.database.close();
      throw error;
    }
    process.env.DC_CITY_HOST = host;
    process.env.DC_CITY_PORT = String(http_port);
    process.env.DC_CITY_RPC_HOST = "127.0.0.1";
    process.env.DC_CITY_RPC_PORT = String(rpc_port);

    let management: ManagementChannel | undefined;
    try {
      await city.listen({
        rpc: { host: "127.0.0.1", port: rpc_port },
        http: { host, port: http_port },
      });
      const state = {
        owner: "cli" as const,
        pid: process.pid,
        instance_id: host_instance_id,
        started_at: new Date().toISOString(),
        http_host: host,
        http_port,
        rpc_host: "127.0.0.1",
        rpc_port,
        management_version: MANAGEMENT_VERSION,
        root_identity: get_root_identity(root_path),
        state: "ready" as const,
        capabilities: resources.capabilities,
      };
      management = await ManagementChannel.listen(root_path, state, resources);
      await register_city_host({ ...state, management_endpoint: management.endpoint }, root_path);
      return new CliCityRuntime({ city, http_port, rpc_port, data, host_instance_id, lease, management, resources });
    } catch (error) {
      await management?.close().catch(() => undefined);
      await resources.dispose().catch(() => undefined);
      await city.close().catch(() => undefined);
      city.federation.set(undefined);
      await federation?.dispose().catch(() => undefined);
      data.database.close();
      throw error;
    }
  }
}
