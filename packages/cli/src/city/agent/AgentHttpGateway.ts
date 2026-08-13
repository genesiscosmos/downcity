/**
 * AgentHttpGateway：City 托管的 Agent HTTP 网关。
 *
 * 职责说明（中文）
 * - 作为 City 多 Agent Gateway 的单 Agent 子应用，承载控制面、Plugin 与 SDK 路由。
 * - HTTP Server 生命周期归 CLI City 管理。
 * - HTTP route 实现放在 City 内部，Agent 只提供 Agent / sessionCollection。
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import http from "node:http";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { Hono as HonoType } from "hono";
import { createExecuteRouter } from "@/city/agent/http/execute/execute.js";
import { healthRouter } from "@/city/agent/http/health/health.js";
import { createPluginsRouter } from "@/city/agent/http/plugins/plugins.js";
import { createStaticRouter } from "@/city/agent/http/static/static.js";
import { createControlRouter } from "@/city/agent/http/control/ControlRouter.js";
import type { Agent } from "@downcity/agent";
import { AuthService } from "@/city/runtime/auth/AuthService.js";
import {
  createRouteAuthGuardMiddleware,
  SERVER_AUTH_ROUTE_POLICIES,
} from "@/city/runtime/auth/RoutePolicy.js";

/**
 * Agent HTTP 网关启动参数。
 */
export interface AgentHttpGatewayStartOptions {
  /** HTTP 服务监听端口。 */
  port: number;
  /** HTTP 服务监听主机。 */
  host: string;
  /** 当前 agent context 读取函数。 */
  get_agent: () => Agent;
  /** 可选 SDK transport 子路由（来自 `@downcity/city` 的 `AgentHTTP.router()`）。 */
  sdkRouter?: HonoType;
  /** CLI 组合根创建并拥有的鉴权服务。 */
  auth_service: AuthService;
}

/**
 * Agent HTTP 网关运行实例。
 */
export interface AgentHttpGatewayInstance {
  /** Hono 应用实例。 */
  app: Hono;
  /** 原生 HTTP Server 实例。 */
  server: http.Server;
  /** 停止当前服务。 */
  stop(): Promise<void>;
}

/**
 * 创建 Agent HTTP 网关 Hono 应用。
 */
export function createAgentHttpGatewayApp(
  options: Pick<
    AgentHttpGatewayStartOptions,
  "get_agent" | "sdkRouter"
  > & { auth_service: AuthService },
): Hono {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", createRouteAuthGuardMiddleware(
    options.auth_service,
    SERVER_AUTH_ROUTE_POLICIES,
  ));

  // 关键点（中文）：HTTP 协议面由 City 装配，Agent 只提供 Agent。
  app.route("/", createStaticRouter({
    get_agent: options.get_agent,
  }));
  app.route("/", healthRouter);
  app.route("/", createPluginsRouter({
    get_agent: options.get_agent,
  }));
  app.route("/", createExecuteRouter({
    get_agent: options.get_agent,
  }));
  app.route("/", createControlRouter({
    get_agent: options.get_agent,
  }));
  if (options.sdkRouter) {
    app.route("/", options.sdkRouter);
  }
  options.get_agent().register_plugin_http_routes(app);

  return app;
}

/**
 * 启动 City 托管的 Agent HTTP 网关。
 */
export async function startAgentHttpGateway(
  options: AgentHttpGatewayStartOptions,
): Promise<AgentHttpGatewayInstance> {
  const app = createAgentHttpGatewayApp(options);
  const server = create_node_http_server(app, options);
  const server_logger = options.get_agent().get_logger();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host, () => {
        server.off("error", reject);
        server_logger.info(
          `🚀 City Agent HTTP gateway started: http://${options.host}:${options.port}`,
        );
        resolve();
      });
    });
  } catch (error) {
    throw error;
  }

  return {
    app,
    server,
    async stop(): Promise<void> {
      await server_logger.save_all_logs();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      server_logger.info("City Agent HTTP gateway stopped");
    },
  };
}

/**
 * 创建 Node HTTP Server 适配层。
 */
/** 把已经装配好的 CLI Gateway Hono 应用接到 Node HTTP Server。 */
export function create_node_http_server(
  app: Hono,
  options: Pick<AgentHttpGatewayStartOptions, "host" | "port">,
): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${options.host}:${options.port}`);
      const method = req.method || "GET";
      const bodyBuffer = await readRequestBody(req);
      const request = new Request(url.toString(), {
        method,
        headers: new Headers(req.headers as Record<string, string>),
        body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
      });

      const response = await app.fetch(request);
      res.statusCode = response.status;
      for (const [key, value] of response.headers.entries()) {
        res.setHeader(key, value);
      }
      if (!response.body) {
        res.end();
        return;
      }
      const bodyStream = Readable.fromWeb(
        response.body as unknown as globalThis.ReadableStream<Uint8Array>,
      );
      bodyStream.pipe(res);
      await finished(bodyStream).catch(() => undefined);
    } catch {
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });
}

/**
 * 读取原生请求体。
 */
async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
