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
import type { AgentWorkspace } from "@/internal/index.js";
import { register_sdk_session_routes } from "@/city/transport/http/routes/SessionRoutes.js";
import { register_runtime_routes } from "@/city/transport/http/routes/RuntimeRoutes.js";
import { create_node_http_server } from "@/city/transport/http/NodeHttpAdapter.js";
import { SerializedTransport } from "@/city/transport/SerializedTransport.js";
import type {
  AgentHttpBinding,
  AgentHttpListenOptions,
} from "@/city/transport/types/AgentHttpBinding.js";
import type { AgentHttpRuntimeOptions } from "@/city/transport/types/AgentHttpRuntime.js";

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
 * 把一个 `AgentWorkspace` 暴露为最小 SDK HTTP 面。
 */
export class AgentHTTP {
  private readonly agent_workspace: AgentWorkspace;
  private readonly runtime_options: AgentHttpRuntimeOptions;
  private cached_router: Hono | null = null;
  private cached_server: AgentHttpServerHandle | null = null;

  constructor(agent_workspace: AgentWorkspace, runtime_options: AgentHttpRuntimeOptions = {}) {
    this.agent_workspace = agent_workspace;
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
    register_sdk_session_routes(router, this.agent_workspace.sessions, {
      resolve_session_model: this.runtime_options.resolve_session_model,
    });
    register_runtime_routes(router, this.agent_workspace);
    this.cached_router = router;
    return router;
  }

  /**
   * 返回独立 HTTP server 句柄。
   */
  server(): AgentHttpServerHandle {
    if (this.cached_server) return this.cached_server;
    const handle = create_agent_http_server_handle(this.router());
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
    if (!handle) return;
    await handle.close();
  }
}

/** 为已装配完成的 Hono Router 创建独立 Node HTTP Server 句柄。 */
export function create_agent_http_server_handle(app: Hono): AgentHttpServerHandle {
  const lifecycle = new SerializedTransport<
    AgentHttpListenOptions,
    http.Server,
    AgentHttpBinding
  >({
    start: async (options) => {
      const host = String(options.host || DEFAULT_HTTP_HOST).trim() || DEFAULT_HTTP_HOST;
      const port = options.port;
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error("AgentHTTP server requires a valid TCP port");
      }
      const server = create_node_http_server({ app, host, port });
      await new Promise<void>((resolve, reject) => {
        const on_error = (error: Error): void => {
          server.off("error", on_error);
          // listen 失败时该 Server 不会进入生命周期对象，立即清理监听器和句柄。
          try {
            server.close();
          } catch {
            // 未进入监听态时 close 可能抛出 ERR_SERVER_NOT_RUNNING，可安全忽略。
          }
          reject(error);
        };
        server.once("error", on_error);
        server.listen(port, host, () => {
          server.off("error", on_error);
          resolve();
        });
      });
      return {
        resource: server,
        binding: { url: `http://${host}:${port}`, host, port },
      };
    },
    stop: async (server) => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  });

  return {
    async listen(options: AgentHttpListenOptions): Promise<AgentHttpBinding> {
      return await lifecycle.listen(options);
    },
    async close(): Promise<void> {
      await lifecycle.close();
    },
    binding(): AgentHttpBinding | null {
      return lifecycle.binding();
    },
  };
}
