/**
 * City：Workspace、Embassy 与统一 transport 的资源容器。
 *
 * City 不创建 Agent、Session 或 Plugin。应用创建 Agent 后通过
 * `city.agents.add(agent)` 加入当前容器；City 管理 Agent 集合、Workspace/Embassy
 * 资源与统一 transport。
 */

import { Agent } from "@downcity/agent";
import {
  attach_agent_city,
  create_agent_workspace,
  detach_agent_city,
  get_agent_workspace,
  type AgentCity,
  type AgentWorkspace,
} from "@downcity/agent/internal";
import type { WorkspaceBase } from "@downcity/workspace";
import { CityHTTP } from "@/transport/http/CityHTTP.js";
import { CityRPC } from "@/transport/rpc/CityRPC.js";
import type {
  CityAgents,
  CityListenOptions,
  CityOptions,
  CityRuntimeOptions,
  CityWorkspaces,
} from "@/types/City.js";

/** Agent 实例索引与 transport 宿主。 */
export class City implements AgentCity {
  /** 当前 City 引用的 Agent，按稳定 ID 索引。 */
  private readonly agents_by_id = new Map<string, Agent>();

  /** City 面向应用的 Agent 集合入口。 */
  readonly agents: CityAgents;

  /** City 面向宿主的 Workspace 集合入口。 */
  readonly workspaces: CityWorkspaces;

  /** City 持有的 Workspace 资源，按稳定 ID 索引。 */
  private readonly workspaces_by_id = new Map<string, WorkspaceBase>();

  /** City 绑定的 Embassy 服务入口。 */
  readonly embassy?: CityOptions["embassy"];

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

  /** City 自身的生命周期状态。 */
  private city_status: "active" | "closing" | "closed" = "active";

  /** City 关闭流程；并发调用共享同一个 Promise。 */
  private close_promise?: Promise<void>;

  constructor(options: CityOptions = {}) {
    this.embassy = options.embassy;
    for (const workspace of options.workspaces ?? []) {
      const workspace_id = String(workspace?.id || "").trim();
      if (!workspace_id) throw new Error("City requires Workspace with a stable id");
      if (this.workspaces_by_id.has(workspace_id)) {
        throw new Error(`Workspace already exists in City: ${workspace_id}`);
      }
      workspace.shell?.bind({
        root_path: workspace.path,
        data_path: workspace.storage.open_scope([
          "cities",
          workspace_id,
          "shell",
        ]).root_path,
      });
      this.workspaces_by_id.set(workspace_id, workspace);
    }
    const runtime_options = options.runtime ?? {};
    this.resolve_workspace = runtime_options.resolve_workspace;
    this.http = new CityHTTP(this, runtime_options.http);
    this.rpc = new CityRPC(this, runtime_options.rpc);
    this.agents = Object.freeze({
      add: (agent) => this.add_agent(agent),
      get: (agent_id) => this.get_agent(agent_id),
      list: () => this.list_agents(),
      remove: async (agent_id) => await this.remove_agent(agent_id),
    });
    this.workspaces = Object.freeze({
      add: (workspace) => this.add_workspace(workspace),
      get: (workspace_id) => this.workspace(workspace_id),
      list: () => this.list_workspaces(),
    });
  }

  /** 返回 City 持有的 Workspace；不存在时返回 null。 */
  workspace(workspace_id_input: string): WorkspaceBase | null {
    const workspace_id = String(workspace_id_input || "").trim();
    return this.workspaces_by_id.get(workspace_id) ?? null;
  }

  /** 返回 City 持有的 Workspace 稳定快照。 */
  private list_workspaces(): readonly WorkspaceBase[] {
    return [...this.workspaces_by_id.values()];
  }

  /** 返回当前 City 已注册 Agent 的稳定快照。 */
  private list_agents(): readonly Agent[] {
    return [...this.agents_by_id.entries()]
      .filter(([agent_id]) => !this.removing_agent_ids.has(agent_id))
      .map(([, agent]) => agent);
  }

  /** 按稳定 ID 返回可直接使用的 Agent；不存在时返回 null。 */
  private get_agent(agent_id_input: string): Agent | null {
    const agent_id = String(agent_id_input || "").trim();
    if (this.removing_agent_ids.has(agent_id)) return null;
    return this.agents_by_id.get(agent_id) ?? null;
  }

  /** 按稳定 ID 返回内部 transport 所需 Agent；不存在时抛出明确错误。 */
  private require_agent(agent_id_input: string): Agent {
    const agent_id = String(agent_id_input || "").trim();
    const agent = this.get_agent(agent_id);
    if (!agent) throw new Error(`Agent not found in City: ${agent_id}`);
    return agent;
  }

  /** 按 Agent ID 与 Workspace ID 返回 transport 所需的明确执行作用域。 */
  require_workspace(agent_id_input: string, workspace_id_input: string): AgentWorkspace {
    const agent = this.require_agent(agent_id_input);
    const workspace_id = String(workspace_id_input || "").trim();
    if (!workspace_id) throw new Error("City request requires workspace_id");
    const entry = get_agent_workspace(agent, workspace_id);
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
    const existing = get_agent_workspace(agent, workspace_id);
    if (existing) return existing;
    const city_workspace = this.workspace(workspace_id);
    if (city_workspace) return create_agent_workspace(agent, city_workspace);
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
      this.add_workspace(workspace);
      return create_agent_workspace(agent, workspace);
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

  /** 停止、释放并从 City 移除指定 Agent。 */
  private async remove_agent(agent_id_input: string): Promise<Agent | null> {
    const agent_id = String(agent_id_input || "").trim();
    const existing_removal = this.removal_promises.get(agent_id);
    if (existing_removal) return await existing_removal;
    const agent = this.agents_by_id.get(agent_id) ?? null;
    if (!agent) return null;
    this.removing_agent_ids.add(agent_id);
    const removal = (async () => {
      try {
        await this.http.detach_agent(agent_id);
        await agent.dispose();
        this.release_agent(agent);
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
    this.assert_active();
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

  /** 幂等关闭 transport，并按依赖顺序释放绑定 Agent 与 City Workspace。 */
  async close(): Promise<void> {
    if (this.city_status === "closed") return;
    if (!this.close_promise) {
      const close_operation = this.enqueue_transport_operation(async () => {
        this.city_status = "closing";
        const results: PromiseSettledResult<unknown>[] = [];
        results.push(...await Promise.allSettled([this.http.close(), this.rpc.close()]));
        results.push(...await Promise.allSettled(this.agents.list().map(async (agent) => await agent.dispose())));
        results.push(...await Promise.allSettled(
          [...this.workspaces_by_id.values()].map(async (workspace) => await workspace.dispose()),
        ));
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length > 0) {
          this.city_status = "active";
          throw new AggregateError(errors, "City transport close failed");
        }
        this.agents_by_id.clear();
        this.workspaces_by_id.clear();
        this.city_status = "closed";
      });
      this.close_promise = close_operation.catch((error) => {
        this.close_promise = undefined;
        throw error;
      });
    }
    await this.close_promise;
  }

  /** 将已创建 Agent 加入集合并建立唯一 City 绑定。 */
  private add_agent(agent: Agent): Agent {
    this.assert_active();
    if (!agent?.id) throw new Error("City requires an Agent with a stable ID");
    if (this.agents_by_id.has(agent.id) || this.removing_agent_ids.has(agent.id)) {
      throw new Error(`Agent already exists in City: ${agent.id}`);
    }
    attach_agent_city(agent, this);
    this.agents_by_id.set(agent.id, agent);
    return agent;
  }

  /** Agent 自行释放时清除 City 运行时引用。 */
  release_agent(agent: { readonly id: string }): void {
    const current = this.agents_by_id.get(agent.id);
    if (!current || current !== agent) return;
    detach_agent_city(current, this);
    this.agents_by_id.delete(agent.id);
    void this.http.detach_agent(agent.id).catch(() => undefined);
  }

  /** 把宿主按需解析出的 Workspace 纳入 City 资源索引。 */
  private add_workspace(workspace: WorkspaceBase): WorkspaceBase {
    this.assert_active();
    const workspace_id = String(workspace?.id || "").trim();
    if (!workspace_id) throw new Error("City requires Workspace with a stable id");
    const existing = this.workspaces_by_id.get(workspace_id);
    if (existing && existing !== workspace) {
      throw new Error(`Workspace already exists in City: ${workspace_id}`);
    }
    if (existing) return existing;
    workspace.shell?.bind({
      root_path: workspace.path,
      data_path: workspace.storage.open_scope(["cities", workspace_id, "shell"]).root_path,
    });
    this.workspaces_by_id.set(workspace_id, workspace);
    return workspace;
  }

  /** 拒绝在 City 关闭后继续注入运行时资源。 */
  private assert_active(): void {
    if (this.city_status !== "active") {
      throw new Error(`City is ${this.city_status}`);
    }
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
