/**
 * CityHTTP：在一个 HTTP Server 上暴露 City 持有的全部 Agent。
 *
 * 每个 Agent 固定挂载到 `/agents/<agent_id>`。调用方可以直接把该地址交给
 * `RemoteAgent`，transport 只负责路由，不复制 Agent 或 Session 状态。
 */

import { Hono, type Context } from "hono";
import type { City } from "@/runtime/City.js";
import {
  AgentHTTP,
  create_agent_http_server_handle,
  type AgentHttpServerHandle,
} from "@/transport/http/AgentHTTP.js";
import type { CityHttpRuntimeOptions } from "@/transport/types/CityHttpRuntime.js";
import type {
  AgentHttpBinding,
  AgentHttpListenOptions,
} from "@/transport/types/AgentHttpBinding.js";

/** 在单一 HTTP 端口暴露 City 的多 Agent transport。 */
export class CityHTTP {
  private readonly city: City;
  private readonly runtime_options: CityHttpRuntimeOptions;
  private readonly routers_by_agent = new Map<string, { agent: object; router: Hono }>();
  private readonly extension_disposers = new Map<string, () => void | Promise<void>>();
  /** 每个 Agent 路由装配与释放的独立串行链。 */
  private readonly agent_operation_chains = new Map<string, Promise<void>>();
  private cached_router: Hono | null = null;
  private cached_server: AgentHttpServerHandle | null = null;

  constructor(city: City, runtime_options: CityHttpRuntimeOptions = {}) {
    this.city = city;
    this.runtime_options = runtime_options;
  }

  /** 返回按 Agent ID 分区的 Hono Router。 */
  router(): Hono {
    if (this.cached_router) return this.cached_router;
    const root = new Hono();
    root.all("/agents/:agent_id", async (context) => await this.dispatch_agent(context));
    root.all("/agents/:agent_id/*", async (context) => await this.dispatch_agent(context));
    if (this.runtime_options.city_router) root.route("/", this.runtime_options.city_router);
    root.get("/internal/status", (context) => context.json({
      success: true,
      status: "ok",
      pid: process.pid,
      agent_ids: this.city.agents().map((agent) => agent.id),
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
    const agent_ids = new Set([
      ...this.routers_by_agent.keys(),
      ...this.extension_disposers.keys(),
    ]);
    const results = await Promise.allSettled(
      [...agent_ids].map(async (agent_id) => await this.detach_agent(agent_id)),
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
    await this.enqueue_agent_operation(agent_id, async () => {
      const dispose = this.extension_disposers.get(agent_id);
      if (dispose) await dispose();
      this.routers_by_agent.delete(agent_id);
      if (this.extension_disposers.get(agent_id) === dispose) {
        this.extension_disposers.delete(agent_id);
      }
    });
  }

  /** 按请求中的 Agent ID 动态选择子路由，保证运行中新增 Agent 立即可见。 */
  private async dispatch_agent(context: Context): Promise<Response> {
    const agent_id = decodeURIComponent(String(context.req.param("agent_id") || "")).trim();
    const agent = this.city.agent(agent_id);
    if (!agent) return context.json({ success: false, error: `Agent not found: ${agent_id}` }, 404);
    const router = await this.resolve_agent_router(agent_id, agent);
    if (!router) {
      return context.json({ success: false, error: `Agent not found: ${agent_id}` }, 404);
    }
    const url = new URL(context.req.url);
    const prefix = `/agents/${encodeURIComponent(agent_id)}`;
    url.pathname = url.pathname.slice(prefix.length) || "/";
    return await router.fetch(new Request(url, context.req.raw));
  }

  /** 串行解析或创建指定 Agent 的唯一 Router。 */
  private async resolve_agent_router(
    agent_id: string,
    agent: NonNullable<ReturnType<City["agent"]>>,
  ): Promise<Hono | null> {
    return await this.enqueue_agent_operation(agent_id, async () => {
      // Agent 可能在请求排队期间被 City 删除，装配前必须重新确认所有权。
      if (this.city.agent(agent_id) !== agent) return null;
      const cached = this.routers_by_agent.get(agent_id);
      if (cached?.agent === agent) return cached.router;
      if (cached) {
        const dispose = this.extension_disposers.get(agent_id);
        if (dispose) await dispose();
        this.routers_by_agent.delete(agent_id);
        if (this.extension_disposers.get(agent_id) === dispose) {
          this.extension_disposers.delete(agent_id);
        }
      }

      const resolve_session_model = this.runtime_options.resolve_session_model;
      const sdk_router = new AgentHTTP(agent, {
        resolve_session_model: resolve_session_model
          ? async (model_id) => await resolve_session_model(agent.id, model_id)
          : undefined,
      }).router();
      const extension = this.runtime_options.create_agent_extension?.({ agent, sdk_router });
      const router = extension?.router ?? sdk_router;
      this.routers_by_agent.set(agent_id, { agent, router });
      if (extension?.dispose) this.extension_disposers.set(agent_id, extension.dispose);
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
