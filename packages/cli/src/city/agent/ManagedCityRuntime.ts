/**
 * CLI City 进程组合根。
 *
 * 一个进程只创建一个 LocalCityStore 和一个 City，恢复全部已绑定 Agent，并拥有
 * 一个 HTTP Server 与一个 RPC Server。Agent 不拥有独立启动状态或端口。
 */

import { City, CityRPC, LocalCityStore } from "@downcity/city";
import { start_city_http_gateway } from "@/city/agent/CityHttpGateway.js";
import type { CityDaemonOptions } from "@/city/process/daemon/Types.js";

/** 已启动的 CLI City Runtime。 */
export class ManagedCityRuntime {
  /** 当前进程唯一的 City。 */
  readonly city: City;
  /** 当前 City HTTP 端口。 */
  readonly http_port: number;
  /** 当前 City RPC 端口。 */
  readonly rpc_port: number;

  private readonly rpc: CityRPC;
  private readonly gateway: Awaited<ReturnType<typeof start_city_http_gateway>>;
  private stopped = false;

  private constructor(input: {
    /** 当前 City。 */
    city: City;
    /** City RPC transport。 */
    rpc: CityRPC;
    /** CLI HTTP Gateway。 */
    gateway: Awaited<ReturnType<typeof start_city_http_gateway>>;
    /** HTTP 端口。 */
    http_port: number;
    /** RPC 端口。 */
    rpc_port: number;
  }) {
    this.city = input.city;
    this.rpc = input.rpc;
    this.gateway = input.gateway;
    this.http_port = input.http_port;
    this.rpc_port = input.rpc_port;
  }

  /** 按依赖逆序幂等释放全部宿主资源。 */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const results = await Promise.allSettled([
      this.gateway.stop(),
      this.rpc.close(),
    ]);
    await this.city.dispose();
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "City transport shutdown failed");
  }

  /** 从全局 Store 创建并启动完整 CLI City Runtime。 */
  static async start(options: CityDaemonOptions): Promise<ManagedCityRuntime> {
    const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
    const http_port = options.http_port ?? 5314;
    const rpc_port = options.rpc_port ?? 15314;
    if (http_port === rpc_port) throw new Error("City HTTP and RPC ports must be different");

    const store = new LocalCityStore({ host, port: http_port });
    const city = new City(store);
    try {
      await city.ready();
    } catch (error) {
      await city.dispose().catch(() => undefined);
      throw error;
    }

    process.env.DC_CITY_HOST = host;
    process.env.DC_CITY_PORT = String(http_port);
    process.env.DC_CITY_RPC_HOST = "127.0.0.1";
    process.env.DC_CITY_RPC_PORT = String(rpc_port);

    const rpc = new CityRPC(city, {
      resolve_session_model: async (_agent_id, model_id) => await store.create_model(model_id),
      reload_workspace_env: (agent_id) => {
        const env = store.reload_agent_env(agent_id);
        city.require_agent(agent_id).workspace.set_env(env);
        return env;
      },
    });
    try {
      await rpc.listen({ host: "127.0.0.1", port: rpc_port });
      const gateway = await start_city_http_gateway({
        city,
        store,
        host,
        port: http_port,
      });
      return new ManagedCityRuntime({ city, rpc, gateway, http_port, rpc_port });
    } catch (error) {
      await rpc.close().catch(() => undefined);
      await city.dispose().catch(() => undefined);
      throw error;
    }
  }
}
