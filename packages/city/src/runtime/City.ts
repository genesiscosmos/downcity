/**
 * City：一个 Store 下的 Agent 集合与统一 transport 宿主。
 *
 * City 根据 Store 提供的配置装配 Agent 实例，并统一拥有实例集合与 HTTP/RPC。
 */

import { Agent } from "@downcity/agent";
import { CityHTTP } from "@/transport/http/CityHTTP.js";
import { CityRPC } from "@/transport/rpc/CityRPC.js";
import type { CityEnvironment } from "@/types/CityEnvironment.js";
import type { CityStore } from "@/types/CityStore.js";
import type { CityListenOptions, CityState } from "@/types/City.js";
import type { CityHttpRuntimeOptions } from "@/transport/types/CityHttpRuntime.js";
import type { CityRpcRuntimeOptions } from "@/transport/types/CityRpcRuntime.js";

/** City 构造时可注入的 transport 扩展能力。 */
export interface CityRuntimeOptions {
  /** HTTP transport 的模型解析和宿主扩展路由。 */
  http?: CityHttpRuntimeOptions;

  /** RPC transport 的模型解析与环境刷新能力。 */
  rpc?: CityRpcRuntimeOptions;
}

/** Agent 实例集合与 transport 宿主。 */
export class City {
  /** 当前 City 持有的 Agent，按稳定 ID 索引。 */
  private readonly agents_by_id = new Map<string, Agent>();

  /** 当前 City 的持久化适配器。 */
  private readonly store: CityStore;

  /** 当前平台提供的 Agent 运行环境。 */
  private readonly environment?: CityEnvironment;

  /** 当前 City 唯一的 HTTP transport。 */
  private readonly http: CityHTTP;

  /** 当前 City 唯一的 RPC transport。 */
  private readonly rpc: CityRPC;

  /** 当前生命周期阶段。 */
  private state: CityState = "initializing";

  /** 构造时立即开始的唯一初始化 Promise。 */
  private readonly initial_promise: Promise<void>;

  /** 首次释放产生的稳定 Promise。 */
  private dispose_promise?: Promise<void>;

  constructor(
    store: CityStore,
    environment?: CityEnvironment,
    runtime_options: CityRuntimeOptions = {},
  ) {
    if (!store) throw new Error("City requires a Store");
    this.store = store;
    this.environment = environment;
    this.http = new CityHTTP(this, runtime_options.http);
    this.rpc = new CityRPC(this, runtime_options.rpc);
    this.initial_promise = this.initialize();
  }

  /** 等待构造时开始的 Agent 装配完成。 */
  async ready(): Promise<void> {
    this.assert_not_disposed();
    await this.initial_promise;
  }

  /** 返回当前 City 持有的 Agent 稳定快照。 */
  agents(): readonly Agent[] {
    this.assert_ready();
    return [...this.agents_by_id.values()];
  }

  /** 按稳定 ID 返回可直接使用的 Agent；不存在时返回 null。 */
  agent(agent_id_input: string): Agent | null {
    this.assert_ready();
    const agent_id = String(agent_id_input || "").trim();
    return this.agents_by_id.get(agent_id) ?? null;
  }

  /** 按稳定 ID 返回 Agent；不存在时抛出明确错误。 */
  require_agent(agent_id_input: string): Agent {
    const agent_id = String(agent_id_input || "").trim();
    const agent = this.agent(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    return agent;
  }

  /** 注册一个已实例化 Agent，并接管其运行时生命周期。 */
  async add(agent: Agent): Promise<Agent> {
    await this.ready();
    if (!agent?.id) throw new Error("City.add requires an Agent");
    if (this.agents_by_id.has(agent.id)) {
      throw new Error(`Agent already exists in City: ${agent.id}`);
    }
    this.agents_by_id.set(agent.id, agent);
    return agent;
  }

  /** 从 City 移除并释放当前 Agent，不修改产品配置或 Session 数据。 */
  async remove(agent_id_input: string): Promise<Agent | null> {
    await this.ready();
    const agent_id = String(agent_id_input || "").trim();
    const agent = this.agents_by_id.get(agent_id) ?? null;
    if (!agent) return null;
    this.agents_by_id.delete(agent_id);
    const results = await Promise.allSettled([
      this.http.detach_agent(agent_id),
      agent.dispose(),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, `City Agent remove failed: ${agent_id}`);
    }
    return agent;
  }

  /** 等待 Agent 装配后启动 City 唯一的 HTTP/RPC transport。 */
  async listen(options: CityListenOptions): Promise<void> {
    await this.ready();
    const started: Array<() => Promise<void>> = [];
    try {
      if (options.rpc) {
        await this.rpc.listen(options.rpc);
        started.push(async () => await this.rpc.close());
      }
      if (options.http) {
        await this.http.listen(options.http);
        started.push(async () => await this.http.close());
      }
    } catch (error) {
      await Promise.allSettled(started.reverse().map(async (close) => await close()));
      throw error;
    }
  }

  /** 幂等关闭 HTTP/RPC，不释放 Agent 或 Store。 */
  async close(): Promise<void> {
    const results = await Promise.allSettled([
      this.http.close(),
      this.rpc.close(),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "City transport close failed");
  }

  /** 关闭 transport，并释放全部 Agent 与 Store。 */
  async dispose(): Promise<void> {
    this.dispose_promise ??= this.dispose_all();
    await this.dispose_promise;
  }

  /** 读取 Store 配置，并为当前 City 装配全部 Agent 实例。 */
  private async initialize(): Promise<void> {
    const configs = await this.store.load_agent_configs();
    if (configs.length > 0 && !this.environment) {
      throw new Error("City requires an Environment to assemble configured Agents");
    }
    const assembled_agents: Agent[] = [];
    try {
      for (const config of configs) {
        if (this.agents_by_id.has(config.agent_id)) {
          throw new Error(`CityStore returned duplicate Agent config: ${config.agent_id}`);
        }
        const agent = await this.create_agent(config.agent_id, config);
        assembled_agents.push(agent);
        this.agents_by_id.set(agent.id, agent);
      }
      this.state = "ready";
    } catch (error) {
      this.agents_by_id.clear();
      await Promise.allSettled(assembled_agents.map(async (agent) => await agent.dispose()));
      throw error;
    }
  }

  /** 使用 Environment 生成运行时参数，并由 City 创建 Agent 实例。 */
  private async create_agent(
    expected_agent_id: string,
    config: Parameters<CityEnvironment["create_agent_options"]>[0],
  ): Promise<Agent> {
    const environment = this.environment;
    if (!environment) throw new Error("City requires an Environment to assemble Agents");
    const options = await environment.create_agent_options(structuredClone(config));
    if (options.id !== expected_agent_id) {
      await options.workspace.dispose().catch(() => undefined);
      throw new Error(`City Environment changed Agent ID: ${expected_agent_id}`);
    }
    try {
      return new Agent(options);
    } catch (error) {
      await options.workspace.dispose().catch(() => undefined);
      throw error;
    }
  }

  /** 按资源所有权逆序完成最终释放。 */
  private async dispose_all(): Promise<void> {
    await this.initial_promise.catch(() => undefined);
    this.state = "disposed";
    const agents = [...this.agents_by_id.values()];
    this.agents_by_id.clear();
    const close_result = await Promise.allSettled([
      this.close(),
      ...agents.map(async (agent) => await agent.dispose()),
      this.environment?.dispose?.() ?? Promise.resolve(),
      this.store.dispose(),
    ]);
    const errors = close_result.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "City dispose failed");
  }

  /** 断言 City 已完成装配并且尚未释放。 */
  private assert_ready(): void {
    this.assert_not_disposed();
    if (this.state !== "ready") throw new Error("City initialization has not completed");
  }

  /** 断言 City 尚未被永久释放。 */
  private assert_not_disposed(): void {
    if (this.state === "disposed") throw new Error("City is disposed");
  }
}
