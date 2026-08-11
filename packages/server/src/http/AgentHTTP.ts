/**
 * AgentHTTP：把本地 Agent 暴露为最小 SDK HTTP 面的对外类。
 *
 * 关键点（中文）
 * - 仅承载 RemoteAgent 对应的 SDK transport（`/api/sdk/sessions/*`）。
 * - `router()` 返回一个 `Hono` 子路由，调用方 `app.route("/", agent_http.router())` 即可挂载。
 * - `server()` 返回一个独立 HTTP server 句柄，按需自启、自停。
 * - 同一个实例多次取 router/server 都返回缓存对象，避免重复注册。
 */

import http from "node:http";
import { Hono } from "hono";
import type { Agent } from "@downcity/agent";
import { registerSdkSessionRoutes } from "@/http/routes/SessionRoutes.js";
import { registerRuntimeRoutes } from "@/http/routes/RuntimeRoutes.js";
import { createNodeHttpServer } from "@/http/NodeHttpAdapter.js";
import type {
  AgentHttpBinding,
  AgentHttpListenOptions,
} from "@/types/AgentHttpBinding.js";
import type { AgentHttpRuntimeOptions } from "@/types/AgentHttpRuntime.js";

const DEFAULT_HTTP_HOST = "127.0.0.1";

/**
 * AgentHTTP server 句柄。
 */
export interface AgentHttpServerHandle {
  /** 监听 HTTP 端口。 */
  listen(options: AgentHttpListenOptions): Promise<AgentHttpBinding>;
  /** 关闭当前 HTTP server。 */
  close(): Promise<void>;
  /** 当前监听绑定信息，未 listen 时为 `null`。 */
  binding(): AgentHttpBinding | null;
}

/**
 * 把一个 `Agent` 暴露为最小 SDK HTTP 面。
 */
export class AgentHTTP {
  private readonly agent: Agent;
  private readonly runtime_options: AgentHttpRuntimeOptions;
  private cached_router: Hono | null = null;
  private cached_server: AgentHttpServerHandle | null = null;

  constructor(agent: Agent, runtime_options: AgentHttpRuntimeOptions = {}) {
    this.agent = agent;
    this.runtime_options = runtime_options;
  }

  /**
   * 返回一个挂载到外部 hono server 用的子路由。
   *
   * 说明（中文）
   * - 多次调用返回同一个 hono 实例，避免重复注册。
   * - 不在这里附加 CORS / logger，由调用方按需在自己的入口 hono 上挂中间件。
   */
  router(): Hono {
    if (this.cached_router) return this.cached_router;
    const router = new Hono();
    registerSdkSessionRoutes(router, this.agent.sessions, {
      resolve_session_model: this.runtime_options.resolve_session_model,
    });
    registerRuntimeRoutes(router, this.agent);
    this.cached_router = router;
    return router;
  }

  /**
   * 返回独立 HTTP server 句柄。
   */
  server(): AgentHttpServerHandle {
    if (this.cached_server) return this.cached_server;
    const handle = createAgentHttpServerHandle(this.router());
    this.cached_server = handle;
    return handle;
  }

  /**
   * 关闭通过本实例 `server()` 启动的 HTTP server。
   *
   * 说明（中文）
   * - 仅作用于 `server()` 创建的独立 HTTP server。
   * - `router()` 挂到外部 hono 的场景由调用方自己管理生命周期。
   */
  async close(): Promise<void> {
    const handle = this.cached_server;
    this.cached_server = null;
    if (!handle) return;
    await handle.close();
  }
}

function createAgentHttpServerHandle(app: Hono): AgentHttpServerHandle {
  let current_server: http.Server | null = null;
  let current_binding: AgentHttpBinding | null = null;
  let start_promise: Promise<AgentHttpBinding> | null = null;

  return {
    async listen(options: AgentHttpListenOptions): Promise<AgentHttpBinding> {
      if (start_promise) return await start_promise;
      if (current_binding) return current_binding;
      const host =
        String(options.host || DEFAULT_HTTP_HOST).trim() || DEFAULT_HTTP_HOST;
      const port = options.port;
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error("AgentHTTP server requires a valid TCP port");
      }
      start_promise = (async () => {
        const server = createNodeHttpServer({ app, host, port });
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, host, () => {
            server.off("error", reject);
            resolve();
          });
        });
        current_server = server;
        current_binding = {
          url: `http://${host}:${port}`,
          host,
          port,
        };
        return current_binding;
      })();
      try {
        return await start_promise;
      } finally {
        start_promise = null;
      }
    },
    async close(): Promise<void> {
      const server = current_server;
      current_server = null;
      current_binding = null;
      if (!server) return;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
    binding(): AgentHttpBinding | null {
      return current_binding;
    },
  };
}
