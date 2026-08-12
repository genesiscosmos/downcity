/**
 * Agent 本机 RPC server 网络层。
 *
 * 职责说明（中文）
 * - 为本机 `RemoteAgent(rpc://...)` 与 downcity runtime 提供 Agent RPC 入口。
 * - 只负责 TCP/NDJSON framing、socket 生命周期与订阅清理。
 * - 具体 `sdk.*` / `internal.*` 方法由 server handlers 承接。
 */

import net from "node:net";
import type {
  RpcRequest,
  RpcServerFrame,
} from "@/transport/types/RpcProtocol.js";
import type {
  RpcServerStartOptions,
  RpcSocketSubscription,
} from "@/transport/rpc/server/ServerTypes.js";
import { dispatchRpcRequest } from "@/transport/rpc/server/RequestDispatcher.js";

/**
 * RPC server 运行实例。
 */
export interface RpcServerInstance {
  /** 当前监听 host。 */
  host: string;
  /** 当前监听 port。 */
  port: number;
  /** 当前访问 URL。 */
  url: string;
  /** 原生 net server。 */
  server: net.Server;
  /** 停止当前服务。 */
  stop(): Promise<void>;
}

/**
 * 启动 Agent 本机 RPC server。
 */
export async function startRpcServer(
  options: RpcServerStartOptions,
): Promise<RpcServerInstance> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const subscriptions = new Map<string, RpcSocketSubscription>();
    let buffered = "";

    const cleanup_subscriptions = (): void => {
      for (const subscription of subscriptions.values()) {
        subscription.unsubscribe();
      }
      subscriptions.clear();
    };

    const write_frame = (frame: RpcServerFrame): void => {
      socket.write(`${JSON.stringify(frame)}\n`);
    };

    const write_success = (id: string, data?: unknown): void => {
      write_frame({
        id,
        success: true,
        ...(data === undefined ? {} : { data }),
      });
    };

    const write_error = (id: string, error: unknown): void => {
      write_frame({
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    };

    const handle_line = (line: string): void => {
      try {
        const request = JSON.parse(line) as RpcRequest;
        void dispatchRpcRequest({
          request,
          options,
          subscriptions,
          write_success,
          write_error,
          write_event: write_frame,
        });
      } catch (error) {
        write_error("parse", error);
      }
    };

    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      let newline_index = buffered.indexOf("\n");
      while (newline_index >= 0) {
        const line = buffered.slice(0, newline_index).trim();
        buffered = buffered.slice(newline_index + 1);
        if (line) {
          handle_line(line);
        }
        newline_index = buffered.indexOf("\n");
      }
    });

    socket.on("error", () => {
      cleanup_subscriptions();
    });
    socket.on("close", () => {
      sockets.delete(socket);
      cleanup_subscriptions();
    });
    socket.on("end", () => {
      cleanup_subscriptions();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    host: options.host,
    port: options.port,
    url: `rpc://${options.host}:${options.port}`,
    server,
    async stop(): Promise<void> {
      // 关键点（中文）：RPC 是长连接；停止 server 时必须主动关闭现有 socket。
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
