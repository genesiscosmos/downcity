/**
 * City：Workspace、Embassy 与统一 transport 的资源容器。
 *
 * City 不创建 Agent 或 Session。应用创建 Agent 后通过 `city.agents.add(agent)` 加入
 * 当前容器；City 持有 Plugin 唯一实例、配置投影与生命周期，并管理 Agent 集合、
 * Workspace/Embassy 资源和统一 transport。
 */

import { Agent, Group } from "@downcity/agent";
import {
  attach_group_storage,
  bind_agent_runtime,
  create_workspace_entry,
  detach_group_storage,
  get_workspace_entry,
  list_workspace_entries,
  unbind_agent_runtime,
} from "@downcity/agent/internal";
import { CityPluginRuntime } from "@/city/plugin/CityPluginRuntime.js";
import type { CityPlugins } from "@/city/types/CityPlugin.js";
import type { WorkspaceEntry } from "@downcity/agent/internal";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { StorageProvider } from "@/workspace/index.js";
import { MemoryStorageProvider } from "@/workspace/index.js";
import { CityHTTP } from "@/city/transport/http/CityHTTP.js";
import { CityRPC } from "@/city/transport/rpc/CityRPC.js";
import type {
  CityAgents,
  CityGroups,
  CityListenOptions,
  CityOptions,
  CityRuntimeOptions,
  CityWorkspaces,
} from "@/city/types/City.js";

/** Agent 实例索引与 transport 宿主。 */
export class City {
  /** City 持有的底层 Storage；默认是进程内存储。 */
  readonly storage: StorageProvider;

  /** City 持有的 Plugin 查询入口。 */
  readonly plugins: CityPlugins;

  /** City 唯一的 Plugin 生命周期运行时。 */
  private readonly plugin_runtime: CityPluginRuntime;
  /** 当前 City 引用的 Agent，按稳定 ID 索引。 */
  private readonly agents_by_id = new Map<string, Agent>();

  /** 当前 City 引用的 Group，按稳定 ID 索引。 */
  private readonly groups_by_id = new Map<string, Group>();

  /** City 面向应用的 Agent 集合入口。 */
  readonly agents: CityAgents;

  /** City 面向宿主的 Group 集合入口。 */
  readonly groups: CityGroups;

  /** City 面向宿主的 Workspace 集合入口。 */
  readonly workspaces: CityWorkspaces;

  /** City 持有的 Workspace 资源，按稳定 ID 索引。 */
  private readonly workspaces_by_id = new Map<string, WorkspaceRuntime>();

  /** City 绑定的 Embassy 服务入口。 */
  readonly embassy?: CityOptions["embassy"];

  /** 正在解除注册的 Agent；对查询立即不可见，失败后恢复可见。 */
  private readonly removing_agent_ids = new Set<string>();

  /** 每个 Agent 当前唯一的解除注册流程。 */
  private readonly removal_promises = new Map<string, Promise<Agent | null>>();

  /** 宿主提供的按需 Workspace 创建能力。 */
  private readonly resolve_workspace?: CityRuntimeOptions["resolve_workspace"];

  /** 相同 Agent/Workspace 目标当前唯一的进入流程。 */
  private readonly workspace_entry_promises = new Map<string, Promise<WorkspaceEntry>>();

  /** 正在解除注册的 Workspace；对查询与新 Session 立即不可见。 */
  private readonly removing_workspace_ids = new Set<string>();

  /** 每个 Workspace 当前唯一的解除注册流程。 */
  private readonly workspace_removal_promises = new Map<
    string,
    Promise<WorkspaceRuntime | null>
  >();

  /** 当前 City 唯一的 HTTP transport。 */
  private readonly http_transport: CityHTTP;

  /** 当前 City 唯一的 RPC transport。 */
  private readonly rpc_transport: CityRPC;

  /** City transport 组合操作的唯一串行链。 */
  private transport_operation_chain: Promise<void> = Promise.resolve();

  /** City 自身的生命周期状态。 */
  private city_status: "active" | "closing" | "closed" | "failed" = "active";

  /** City 关闭流程；并发调用共享同一个 Promise。 */
  private close_promise?: Promise<void>;

  constructor(options: CityOptions = {}) {
    this.storage = options.storage || new MemoryStorageProvider();
    this.embassy = options.embassy;
    this.plugin_runtime = new CityPluginRuntime({
      city: this,
      ...(options.plugin_host ? { host: options.plugin_host } : {}),
    });
    this.plugins = this.plugin_runtime.public_api;
    for (const plugin of collection_values(options.plugins)) {
      // 构造函数不能等待异步 lifecycle；Agent ready、Plugin 调用与 snapshot
      // 会继续使用同一个受控 ready Promise。
      void this.plugins.add(plugin);
    }
    for (const workspace of collection_values(options.workspaces)) {
      const workspace_id = String(workspace?.id || "").trim();
      if (!workspace_id) throw new Error("City requires Workspace with a stable id");
      if (this.workspaces_by_id.has(workspace_id)) {
        throw new Error(`Workspace already exists in City: ${workspace_id}`);
      }
      this.bind_workspace_shell(workspace);
      this.workspaces_by_id.set(workspace_id, workspace);
    }
    const runtime_options = options.runtime ?? {};
    this.resolve_workspace = runtime_options.resolve_workspace;
    this.http_transport = new CityHTTP(this, runtime_options.http);
    this.rpc_transport = new CityRPC(this, runtime_options.rpc);
    this.agents = Object.freeze({
      add: (agent) => this.add_agent(agent),
      get: (agent_id) => this.get_agent(agent_id),
      list: () => this.list_agents(),
      remove: async (agent_id) => await this.remove_agent(agent_id),
    });
    this.groups = Object.freeze({
      add: (group: Group) => this.add_group(group),
      get: (group_id: string) => this.get_group(group_id),
      list: () => this.list_groups(),
      remove: async (group_id: string) => await this.remove_group(group_id),
    });
    this.workspaces = Object.freeze({
      add: (workspace) => this.add_workspace(workspace),
      get: (workspace_id) => this.get_workspace(workspace_id),
      list: () => this.list_workspaces(),
      remove: async (workspace_id) => await this.remove_workspace(workspace_id),
    });
    for (const agent of collection_values(options.agents)) {
      this.add_agent(agent);
    }
    for (const group of collection_values(options.groups)) {
      this.add_group(group);
    }
  }

  /** 按稳定 ID 获取 City 管理的 Group。 */
  private get_group(group_id_input: string): Group | null {
    return this.groups_by_id.get(String(group_id_input || "").trim()) ?? null;
  }

  /** 返回 City 管理的 Group 稳定快照。 */
  private list_groups(): readonly Group[] {
    return [...this.groups_by_id.values()];
  }

  /** 将已创建 Group 加入 City，并校验成员属于当前 City。 */
  private add_group(group: Group): Group {
    this.assert_active();
    if (!group?.id) throw new Error("City requires a Group with a stable ID");
    const existing = this.groups_by_id.get(group.id);
    if (existing && existing !== group) throw new Error(`Group already exists in City: ${group.id}`);
    if (existing) return existing;
    for (const member of group.members) {
      if (this.agents_by_id.get(member.id) !== member) {
        throw new Error(`Group member is not registered in City: ${member.id}`);
      }
    }
    attach_group_storage(group, this.storage, this);
    this.groups_by_id.set(group.id, group);
    return group;
  }

  /** 释放并移除一个 Group。 */
  private async remove_group(group_id_input: string): Promise<Group | null> {
    const group_id = String(group_id_input || "").trim();
    const group = this.groups_by_id.get(group_id) ?? null;
    if (!group) return null;
    await this.release_group(group);
    return group;
  }

  /** 返回 City 持有的 Workspace；不存在时返回 null。 */
  /** 内部 AgentCity 协议；用户应使用 `city.workspaces.get()`。 */
  get_workspace(workspace_id_input: string): WorkspaceRuntime | null {
    const workspace_id = String(workspace_id_input || "").trim();
    if (this.removing_workspace_ids.has(workspace_id)) return null;
    return this.workspaces_by_id.get(workspace_id) ?? null;
  }

  /** 返回 City 持有的 Workspace 稳定快照。 */
  private list_workspaces(): readonly WorkspaceRuntime[] {
    return [...this.workspaces_by_id.entries()]
      .filter(([workspace_id]) => !this.removing_workspace_ids.has(workspace_id))
      .map(([, workspace]) => workspace);
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
  require_workspace(agent_id_input: string, workspace_id_input: string): WorkspaceEntry {
    const agent = this.require_agent(agent_id_input);
    const workspace_id = String(workspace_id_input || "").trim();
    if (!workspace_id) throw new Error("City request requires workspace_id");
    const workspace = this.get_workspace(workspace_id);
    if (!workspace) throw new Error(`Workspace not found in City: ${workspace_id}`);
    const entry = get_workspace_entry(agent, workspace_id);
    if (!entry || entry.workspace !== workspace) {
      throw new Error(`Agent "${agent.id}" has not entered Workspace: ${workspace_id}`);
    }
    return entry;
  }

  /** 按需解析并进入 Workspace；相同目标的并发请求共享一次创建流程。 */
  async enter_workspace(
    agent_id_input: string,
    workspace_id_input: string,
  ): Promise<WorkspaceEntry> {
    const agent = this.require_agent(agent_id_input);
    const workspace_id = String(workspace_id_input || "").trim();
    if (!workspace_id) throw new Error("City request requires workspace_id");
    if (this.removing_workspace_ids.has(workspace_id)) {
      throw new Error(`Workspace is being removed from City: ${workspace_id}`);
    }
    const existing = get_workspace_entry(agent, workspace_id);
    if (existing) return existing;
    const city_workspace = this.get_workspace(workspace_id);
    if (city_workspace) return create_workspace_entry(agent, city_workspace);
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
      return create_workspace_entry(agent, workspace);
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
        const errors: unknown[] = [];
        try {
          await this.http_transport.detach_agent(agent_id);
        } catch (error) {
          errors.push(error);
        }
        try {
          await this.plugin_runtime.detach_agent(agent_id);
        } catch (error) {
          errors.push(error);
        }
        const dependent_groups = [...this.groups_by_id.values()]
          .filter((group) => group.members.some((member) => member === agent));
        const group_results = await Promise.allSettled(
          dependent_groups.map(async (group) => await this.release_group(group)),
        );
        const group_errors = group_results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        errors.push(...group_errors);
        try {
          await agent.dispose();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length > 0) {
          throw new AggregateError(errors, `Agent cleanup failed: ${agent_id}`);
        }
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
  async http(options: Parameters<CityHTTP["listen"]>[0]): Promise<CityHTTP> {
    this.assert_active();
    await this.enqueue_transport_operation(async () => {
      await this.http_transport.listen(options);
    });
    return this.http_transport;
  }

  /** 启动 City 唯一的 RPC transport。 */
  async rpc(options?: Parameters<CityRPC["listen"]>[0]): Promise<CityRPC> {
    this.assert_active();
    await this.enqueue_transport_operation(async () => {
      await this.rpc_transport.listen(options);
    });
    return this.rpc_transport;
  }

  /** 启动 City 唯一的 HTTP/RPC transport。 */
  async listen(options: CityListenOptions): Promise<void> {
    this.assert_active();
    await this.enqueue_transport_operation(async () => {
      const started: Array<() => Promise<void>> = [];
      try {
        if (options.rpc) {
          const was_listening = Boolean(this.rpc_transport.binding());
          await this.rpc_transport.listen(options.rpc);
          if (!was_listening) started.push(async () => await this.rpc_transport.close());
        }
        if (options.http) {
          const was_listening = Boolean(this.http_transport.binding());
          await this.http_transport.listen(options.http);
          if (!was_listening) started.push(async () => await this.http_transport.close());
        }
      } catch (error) {
        await Promise.allSettled(started.reverse().map(async (close) => await close()));
        throw error;
      }
    });
  }

  /** 幂等关闭 City，并按依赖方向释放入口、主体、Plugin、Workspace 与 Storage。 */
  async close(): Promise<void> {
    if (this.city_status === "closed") return;
    if (!this.close_promise) {
      const close_operation = this.enqueue_transport_operation(async () => {
        this.city_status = "closing";
        const results: PromiseSettledResult<unknown>[] = [];
        results.push(...await Promise.allSettled([
          this.http_transport.close(),
          this.rpc_transport.close(),
        ]));
        results.push(...await Promise.allSettled([
          ...this.removal_promises.values(),
          ...this.workspace_removal_promises.values(),
        ]));
        results.push(...await Promise.allSettled(
          [...this.groups_by_id.values()].map(async (group) => await this.release_group(group)),
        ));
        results.push(...await Promise.allSettled(this.agents.list().map(async (agent) => await agent.dispose())));
        // Agent dispose 会先停止 Session 并释放 Hook scope，再由 Plugin Runtime
        // disconnect Workspace Context；因此 Plugin 实例必须在 Agent 之后 stop。
        results.push(...await Promise.allSettled([this.plugin_runtime.dispose()]));
        results.push(...await Promise.allSettled(
          [...this.workspaces_by_id.values()].map(async (workspace) => await workspace.dispose()),
        ));
        results.push(...await Promise.allSettled([
          this.storage.dispose?.() ?? Promise.resolve(),
        ]));
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length > 0) {
          this.city_status = "failed";
          throw new AggregateError(errors, "City transport close failed");
        }
        this.agents_by_id.clear();
        this.groups_by_id.clear();
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
    let plugins: ReturnType<CityPluginRuntime["attach_agent"]>;
    bind_agent_runtime(agent, {
      owner: this,
      storage: this.storage,
      get_workspace: (workspace_id) => this.get_workspace(workspace_id),
      ensure_ready: async () => await plugins.ensure_ready(),
      connect_workspace: async (workspace, logger) => {
        await plugins.connect_workspace(workspace, logger);
      },
      disconnect_workspace: async (workspace_id) => {
        await plugins.disconnect_workspace(workspace_id);
      },
      tools: (workspace, logger) => plugins.tools(workspace, logger),
      hooks: (workspace, logger) => plugins.hooks(workspace, logger),
      subscribe_plugins: (subscriber) => plugins.subscribe(subscriber),
      release_agent: async (current) => await this.release_agent(current),
    });
    try {
      plugins = this.plugin_runtime.attach_agent(agent);
    } catch (error) {
      unbind_agent_runtime(agent, this);
      throw error;
    }
    this.agents_by_id.set(agent.id, agent);
    return agent;
  }

  /** Agent 自行释放时清除 City 运行时引用。 */
  async release_agent(agent: { readonly id: string }): Promise<void> {
    const current = this.agents_by_id.get(agent.id);
    if (!current || current !== agent) return;
    const errors: unknown[] = [];
    try {
      await this.plugin_runtime.detach_agent(agent.id);
    } catch (error) {
      errors.push(error);
    }
    unbind_agent_runtime(current, this);
    this.agents_by_id.delete(agent.id);
    try {
      await this.http_transport.detach_agent(agent.id);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Agent release failed: ${agent.id}`);
    }
  }

  /** 释放 Group 全部资源并解除其 City Storage 所有权。 */
  private async release_group(group: Group): Promise<void> {
    const errors: unknown[] = [];
    try {
      await group.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await detach_group_storage(group, this);
    } catch (error) {
      errors.push(error);
    }
    this.groups_by_id.delete(group.id);
    if (errors.length > 0) {
      throw new AggregateError(errors, `Group cleanup failed: ${group.id}`);
    }
  }

  /** 把宿主按需解析出的 Workspace 纳入 City 资源索引。 */
  private add_workspace(workspace: WorkspaceRuntime): WorkspaceRuntime {
    this.assert_active();
    const workspace_id = String(workspace?.id || "").trim();
    if (!workspace_id) throw new Error("City requires Workspace with a stable id");
    if (this.removing_workspace_ids.has(workspace_id)) {
      throw new Error(`Workspace is being removed from City: ${workspace_id}`);
    }
    const existing = this.workspaces_by_id.get(workspace_id);
    if (existing && existing !== workspace) {
      throw new Error(`Workspace already exists in City: ${workspace_id}`);
    }
    if (existing) return existing;
    this.bind_workspace_shell(workspace);
    this.workspaces_by_id.set(workspace_id, workspace);
    return workspace;
  }

  /** 释放并移除一个 Workspace；不存在时返回 null。 */
  private async remove_workspace(workspace_id_input: string): Promise<WorkspaceRuntime | null> {
    const workspace_id = String(workspace_id_input || "").trim();
    const existing_removal = this.workspace_removal_promises.get(workspace_id);
    if (existing_removal) return await existing_removal;
    const workspace = this.workspaces_by_id.get(workspace_id) ?? null;
    if (!workspace) return null;
    this.removing_workspace_ids.add(workspace_id);
    const removal = (async () => {
      const entries = [...this.agents_by_id.values()]
        .flatMap((agent) => [...list_workspace_entries(agent)])
        .filter((entry) => entry.workspace === workspace);
      const results = await Promise.allSettled(entries.map(async (entry) => await entry.leave()));
      results.push(...await Promise.allSettled([workspace.dispose()]));
      this.workspaces_by_id.delete(workspace_id);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length > 0) {
        throw new AggregateError(errors, `Workspace cleanup failed: ${workspace_id}`);
      }
      return workspace;
    })();
    this.workspace_removal_promises.set(workspace_id, removal);
    try {
      return await removal;
    } finally {
      this.removing_workspace_ids.delete(workspace_id);
      if (this.workspace_removal_promises.get(workspace_id) === removal) {
        this.workspace_removal_promises.delete(workspace_id);
      }
    }
  }

  /** 将 City 的底层 Storage 绑定到 Workspace 的 Shell 运行目录。 */
  private bind_workspace_shell(workspace: WorkspaceRuntime): void {
    workspace.shell?.bind({
      root_path: workspace.path,
      data_path: this.storage.open_scope(["workspaces", workspace.id, "shell"]).root_path,
    });
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

/** 把构造期对象或数组集合归一化为稳定值序列。 */
function collection_values<TValue>(
  collection: readonly TValue[] | Readonly<Record<string, TValue>> | undefined,
): readonly TValue[] {
  if (!collection) return [];
  return Array.isArray(collection)
    ? collection
    : Object.values(collection);
}
