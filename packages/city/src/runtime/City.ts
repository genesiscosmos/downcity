/**
 * City：Agent 内存索引与统一 transport 转发器。
 *
 * City 不读取配置、不创建 Agent，也不拥有 Agent 的生命周期。宿主负责创建并释放
 * Agent；City 只维护运行时引用，并按 Agent ID 转发 HTTP/RPC 请求。
 */

import { Agent, type AgentWorkspace } from "@downcity/agent";
import { CityHTTP } from "@/transport/http/CityHTTP.js";
import { CityRPC } from "@/transport/rpc/CityRPC.js";
import type { CityListenOptions, CityRuntimeOptions } from "@/types/City.js";

/** Agent 实例索引与 transport 宿主。 */
export class City {
  /** 当前 City 引用的 Agent，按稳定 ID 索引。 */
  private readonly agents_by_id = new Map<string, Agent>();

  /** 正在解除注册的 Agent；对查询立即不可见，失败后恢复可见。 */
  private readonly removing_agent_ids = new Set<string>();

  /** 每个 Agent 当前唯一的解除注册流程。 */
  private readonly removal_promises = new Map<string, Promise<Agent | null>>();

  /** 宿主提供的按需 Workspace 创建能力。 */
  private readonly resolve_workspace?: CityRuntimeOptions["resolve_workspace"];

  /** 相同 Agent/Workspace 目标当前唯一的进入流程。 */
  private readonly workspace_entry_promises = new Map<string, Promise<AgentWorkspace>>();

  /** 当前 City 唯一的 HTTP transport。 */
  private readonly http: CityHTTP;

  /** 当前 City 唯一的 RPC transport。 */
  private readonly rpc: CityRPC;

  /** City transport 组合操作的唯一串行链。 */
  private transport_operation_chain: Promise<void> = Promise.resolve();

  constructor(
    agents: readonly Agent[] = [],
    runtime_options: CityRuntimeOptions = {},
  ) {
    this.resolve_workspace = runtime_options.resolve_workspace;
    this.http = new CityHTTP(this, runtime_options.http);
    this.rpc = new CityRPC(this, runtime_options.rpc);
    for (const agent of agents) this.register_agent(agent);
  }

  /** 返回当前 City 已注册 Agent 的稳定快照。 */
  agents(): readonly Agent[] {
    return [...this.agents_by_id.entries()]
      .filter(([agent_id]) => !this.removing_agent_ids.has(agent_id))
      .map(([, agent]) => agent);
  }

  /** 按稳定 ID 返回可直接使用的 Agent；不存在时返回 null。 */
  agent(agent_id_input: string): Agent | null {
    const agent_id = String(agent_id_input || "").trim();
    if (this.removing_agent_ids.has(agent_id)) return null;
    return this.agents_by_id.get(agent_id) ?? null;
  }

  /** 按稳定 ID 返回 Agent；不存在时抛出明确错误。 */
  require_agent(agent_id_input: string): Agent {
    const agent_id = String(agent_id_input || "").trim();
    const agent = this.agent(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    return agent;
  }

  /** 按 Agent ID 与 Workspace ID 返回明确的执行作用域。 */
  require_workspace(agent_id_input: string, workspace_id_input: string): AgentWorkspace {
    const agent = this.require_agent(agent_id_input);
    const workspace_id = String(workspace_id_input || "").trim();
    if (!workspace_id) throw new Error("City request requires workspace_id");
    const entry = agent.workspace(workspace_id);
    if (!entry) {
      throw new Error(`Agent "${agent.id}" has not entered Workspace: ${workspace_id}`);
    }
    return entry;
  }

  /** 按需解析并进入 Workspace；相同目标的并发请求共享一次创建流程。 */
  async enter_workspace(
    agent_id_input: string,
    workspace_id_input: string,
  ): Promise<AgentWorkspace> {
    const agent = this.require_agent(agent_id_input);
    const workspace_id = String(workspace_id_input || "").trim();
    if (!workspace_id) throw new Error("City request requires workspace_id");
    const existing = agent.workspace(workspace_id);
    if (existing) return existing;
    if (!this.resolve_workspace) {
      throw new Error(`Agent "${agent.id}" has not entered Workspace: ${workspace_id}`);
    }
    const target_key = `${agent.id}/${workspace_id}`;
    const current = this.workspace_entry_promises.get(target_key);
    if (current) return await current;
    const entry_promise = (async () => {
      const workspace = await this.resolve_workspace!(agent, workspace_id);
      if (workspace.id !== workspace_id) {
        await workspace.dispose().catch(() => undefined);
        throw new Error(
          `Resolved Workspace ID mismatch: expected ${workspace_id}, received ${workspace.id}`,
        );
      }
      return agent.enter(workspace);
    })();
    this.workspace_entry_promises.set(target_key, entry_promise);
    try {
      return await entry_promise;
    } finally {
      if (this.workspace_entry_promises.get(target_key) === entry_promise) {
        this.workspace_entry_promises.delete(target_key);
      }
    }
  }

  /** 注册一个已实例化 Agent；City 不接管该实例的生命周期。 */
  add(agent: Agent): Agent {
    return this.register_agent(agent);
  }

  /** 从 City 解除 Agent 注册；不释放实例，也不修改任何持久化数据。 */
  async remove(agent_id_input: string): Promise<Agent | null> {
    const agent_id = String(agent_id_input || "").trim();
    const existing_removal = this.removal_promises.get(agent_id);
    if (existing_removal) return await existing_removal;
    const agent = this.agents_by_id.get(agent_id) ?? null;
    if (!agent) return null;
    this.removing_agent_ids.add(agent_id);
    const removal = (async () => {
      try {
        await this.http.detach_agent(agent_id);
        this.agents_by_id.delete(agent_id);
        return agent;
      } finally {
        this.removing_agent_ids.delete(agent_id);
      }
    })();
    this.removal_promises.set(agent_id, removal);
    try {
      return await removal;
    } finally {
      if (this.removal_promises.get(agent_id) === removal) {
        this.removal_promises.delete(agent_id);
      }
    }
  }

  /** 启动 City 唯一的 HTTP/RPC transport。 */
  async listen(options: CityListenOptions): Promise<void> {
    await this.enqueue_transport_operation(async () => {
      const started: Array<() => Promise<void>> = [];
      try {
        if (options.rpc) {
          const was_listening = Boolean(this.rpc.binding());
          await this.rpc.listen(options.rpc);
          if (!was_listening) started.push(async () => await this.rpc.close());
        }
        if (options.http) {
          const was_listening = Boolean(this.http.binding());
          await this.http.listen(options.http);
          if (!was_listening) started.push(async () => await this.http.close());
        }
      } catch (error) {
        await Promise.allSettled(started.reverse().map(async (close) => await close()));
        throw error;
      }
    });
  }

  /** 幂等关闭 HTTP/RPC，不释放或移除 Agent。 */
  async close(): Promise<void> {
    await this.enqueue_transport_operation(async () => {
      const results = await Promise.allSettled([
        this.http.close(),
        this.rpc.close(),
      ]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length > 0) throw new AggregateError(errors, "City transport close failed");
    });
  }

  /** 注册一个运行时 Agent 引用并维护 ID 唯一性。 */
  private register_agent(agent: Agent): Agent {
    if (!agent?.id) throw new Error("City requires an Agent with a stable ID");
    if (this.agents_by_id.has(agent.id) || this.removing_agent_ids.has(agent.id)) {
      throw new Error(`Agent already exists in City: ${agent.id}`);
    }
    this.agents_by_id.set(agent.id, agent);
    return agent;
  }

  /** 串行执行一次 City transport 组合操作。 */
  private enqueue_transport_operation(operation: () => Promise<void>): Promise<void> {
    const result = this.transport_operation_chain.then(operation);
    this.transport_operation_chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
