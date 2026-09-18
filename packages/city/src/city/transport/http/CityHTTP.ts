/**
 * CityHTTP：在一个 HTTP Server 上暴露 City 持有的全部 Agent。
 *
 * 每个执行作用域固定挂载到 `/agents/<agent_id>/workspaces/<workspace_id>`。
 * `RemoteAgent`，transport 只负责路由，不复制 Agent 或 Session 状态。
 */

import { Hono, type Context } from "hono";
import {
  AgentHTTP,
  create_agent_http_server_handle,
  type AgentHttpServerHandle,
} from "@/city/transport/http/AgentHTTP.js";
import type { CityHttpRuntimeOptions } from "@/city/transport/types/CityHttpRuntime.js";
import type {
  AgentHttpBinding,
  AgentHttpListenOptions,
} from "@/city/transport/types/AgentHttpBinding.js";
import type { CityRuntimeAccess } from "@/city/types/CityRuntimeAccess.js";
import type { WorkspaceRuntime } from "@/workspace/index.js";

/** CityHTTP 实际使用的 City 内部访问能力。 */
type CityHttpAccess = Pick<
  CityRuntimeAccess,
  "get_agent" | "list_agents" | "enter_workspace" | "power_scope"
>;

/** 在单一 HTTP 端口暴露 City 的多 Agent transport。 */
export class CityHTTP {
  private readonly runtime_access: CityHttpAccess;
  private readonly runtime_options: CityHttpRuntimeOptions;
  private readonly routers_by_workspace = new Map<string, { workspace: WorkspaceRuntime; router: Hono }>();
  private readonly extension_disposers = new Map<string, () => void | Promise<void>>();
  /** 每个 Agent 路由装配与释放的独立串行链。 */
  private readonly agent_operation_chains = new Map<string, Promise<void>>();
  private cached_router: Hono | null = null;
  private cached_server: AgentHttpServerHandle | null = null;

  constructor(runtime_access: CityHttpAccess, runtime_options: CityHttpRuntimeOptions = {}) {
    this.runtime_access = runtime_access;
    this.runtime_options = runtime_options;
  }

  /** 返回按 Agent ID 分区的 Hono Router。 */
  router(): Hono {
    if (this.cached_router) return this.cached_router;
    const root = new Hono();
    root.all("/agents/:agent_id/workspaces/:workspace_id", async (context) => await this.dispatch_workspace(context));
    root.all("/agents/:agent_id/workspaces/:workspace_id/*", async (context) => await this.dispatch_workspace(context));
    if (this.runtime_options.city_router) root.route("/", this.runtime_options.city_router);
    root.get("/internal/status", (context) => context.json({
      success: true,
      status: "ok",
      pid: process.pid,
      agent_ids: this.runtime_access.list_agents().map((agent) => agent.id),
    }));
    this.cached_router = root;
    return root;
  }

  /** 返回 City 级 HTTP Server 句柄。 */
  server(): AgentHttpServerHandle {
    if (this.cached_server) return this.cached_server;
    this.cached_server = create_agent_http_server_handle(this.router());
    return this.cached_server;
  }

  /** 监听 City 级 HTTP 端口。 */
  async listen(options: AgentHttpListenOptions): Promise<AgentHttpBinding> {
    return await this.server().listen(options);
  }

  /** 返回当前监听绑定；尚未监听时返回 null。 */
  binding(): AgentHttpBinding | null {
    return this.cached_server?.binding() ?? null;
  }

  /** 幂等关闭独立启动的 HTTP Server。 */
  async close(): Promise<void> {
    const server = this.cached_server;
    const server_results = server
      ? await Promise.allSettled([server.close()])
      : [];
    const route_keys = new Set([
      ...this.routers_by_workspace.keys(),
      ...this.extension_disposers.keys(),
    ]);
    const results = await Promise.allSettled(
      [...route_keys].map(async (route_key) => await this.detach_route(route_key)),
    );
    const errors = [...server_results, ...results].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "CityHTTP extension close failed");
  }

  /** 立即释放指定 Agent 的宿主扩展并清除路由缓存。 */
  async detach_agent(agent_id_input: string): Promise<void> {
    const agent_id = String(agent_id_input || "").trim();
    if (!agent_id) return;
    const route_keys = new Set([
      ...[...this.routers_by_workspace.keys()].filter((key) => key.startsWith(`${agent_id}/`)),
      ...[...this.extension_disposers.keys()].filter((key) => key.startsWith(`${agent_id}/`)),
    ]);
    await Promise.all([...route_keys].map(async (route_key) => await this.detach_route(route_key)));
  }

  /** 释放一个 Agent/Workspace 路由对应的宿主扩展。 */
  private async detach_route(route_key: string): Promise<void> {
    await this.enqueue_agent_operation(route_key, async () => {
      const dispose = this.extension_disposers.get(route_key);
      if (dispose) await dispose();
      this.routers_by_workspace.delete(route_key);
      if (this.extension_disposers.get(route_key) === dispose) {
        this.extension_disposers.delete(route_key);
      }
    });
  }

  /** 按请求中的 Agent ID 动态选择子路由，保证运行中新增 Agent 立即可见。 */
  private async dispatch_workspace(context: Context): Promise<Response> {
    const agent_id = decodeURIComponent(String(context.req.param("agent_id") || "")).trim();
    const workspace_id = decodeURIComponent(String(context.req.param("workspace_id") || "")).trim();
    const agent = this.runtime_access.get_agent(agent_id);
    if (!agent) return context.json({ success: false, error: `Agent not found: ${agent_id}` }, 404);
    const workspace = await this.runtime_access.enter_workspace(agent_id, workspace_id)
      .catch(() => null);
    if (!workspace) return context.json({
      success: false,
      error: `Workspace not found: ${workspace_id}`,
    }, 404);
    const router = await this.resolve_workspace_router(agent_id, workspace_id, workspace);
    if (!router) {
      return context.json({ success: false, error: `Agent not found: ${agent_id}` }, 404);
    }
    const url = new URL(context.req.url);
    const prefix = `/agents/${encodeURIComponent(agent_id)}/workspaces/${encodeURIComponent(workspace_id)}`;
    url.pathname = url.pathname.slice(prefix.length) || "/";
    return await router.fetch(new Request(url, context.req.raw));
  }

  /** 串行解析或创建指定 Agent 的唯一 Router。 */
  private async resolve_workspace_router(
    agent_id: string,
    workspace_id: string,
    workspace: WorkspaceRuntime,
  ): Promise<Hono | null> {
    const route_key = `${agent_id}/${workspace_id}`;
    return await this.enqueue_agent_operation(route_key, async () => {
      // Agent 可能在请求排队期间被 City 删除，装配前必须重新确认所有权。
      const agent = this.runtime_access.get_agent(agent_id);
      if (!agent) return null;
      const current_workspace = await this.runtime_access.enter_workspace(agent_id, workspace_id)
        .catch(() => null);
      if (current_workspace !== workspace) return null;
      const cached = this.routers_by_workspace.get(route_key);
      if (cached && cached.workspace === workspace) return cached.router;
      if (cached) {
        const dispose = this.extension_disposers.get(route_key);
        if (dispose) await dispose();
        this.routers_by_workspace.delete(route_key);
        if (this.extension_disposers.get(route_key) === dispose) {
          this.extension_disposers.delete(route_key);
        }
      }

      const resolve_session_model = this.runtime_options.resolve_session_model;
      const powers = this.runtime_access.power_scope(agent_id, workspace_id);
      const sdk_router = new AgentHTTP({ agent, workspace, powers }, {
        resolve_session_model: resolve_session_model
          ? async (model_id) => await resolve_session_model({
              agent,
              workspace,
              model_id,
            })
          : undefined,
      }).router();
      const extension = this.runtime_options.create_agent_extension?.({
        agent,
        workspace,
        powers,
        sdk_router,
      });
      const router = extension?.router ?? sdk_router;
      this.routers_by_workspace.set(route_key, { workspace, router });
      if (extension?.dispose) this.extension_disposers.set(route_key, extension.dispose);
      return router;
    });
  }

  /** 按 Agent ID 串行执行路由装配或释放，并在完成后清理空闲链。 */
  private enqueue_agent_operation<TResult>(
    agent_id: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.agent_operation_chains.get(agent_id) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.agent_operation_chains.set(agent_id, settled);
    void settled.finally(() => {
      if (this.agent_operation_chains.get(agent_id) === settled) {
        this.agent_operation_chains.delete(agent_id);
      }
    });
    return result;
  }
}
