/**
 * 一次性本地 OAuth callback HTTP server。
 *
 * 授权 URL 的 redirect_uri 指向 `http://127.0.0.1:<port>/callback`。
 * server 在浏览器完成授权后把 code/state 重定向回这里；本模块只负责
 * 校验 state 并把 query 交还调用方，不做任何 token 交换。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

/** 一次成功 callback 的结果。 */
export interface OAuthCallbackResult {
  /** 授权服务器返回的 authorization code。 */
  code: string;
  /** 本地 server 实际监听的 redirect URI。 */
  redirect_uri: string;
}

/** 本地 callback server。 */
export class OAuthCallbackServer {
  /** 底层 HTTP server。 */
  private server?: Server;
  /** 实际绑定的端口；0 表示尚未启动。 */
  private port = 0;
  /** Closing the listener also settles any outstanding callback promise. */
  private readonly lifetime = new AbortController();

  /** 启动监听并返回可注册到授权 URL 的 redirect URI。 */
  async start(port = 0): Promise<string> {
    this.server = createServer();
    await new Promise<void>((resolve, reject) => {
      // 绑定回环地址即可；0 端口由系统分配，避免与其他本地服务冲突。
      this.server!.listen(port, "127.0.0.1", () => resolve());
      this.server!.on("error", reject);
    });
    this.port = (this.server.address() as { port: number }).port;
    return `http://127.0.0.1:${this.port}/callback`;
  }

  /**
   * 等待一次 state 匹配的 callback。
   *
   * @param expected_state 发起授权时生成的 state，用于防 CSRF。
   * @param timeout_ms 等待超时；超时后关闭 server 并抛错。
   */
  async wait(expected_state: string, timeout_ms: number, signal?: AbortSignal): Promise<OAuthCallbackResult> {
    if (!this.server) throw new Error("OAuth callback server is not started");
    signal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    return await new Promise<OAuthCallbackResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`OAuth authorization timed out after ${Math.round(timeout_ms / 1000)}s`));
      }, timeout_ms);
      const on_request = (request: IncomingMessage, response: ServerResponse) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method !== "GET" || url.pathname !== "/callback") { this.respond(response, 404, "Not found"); return; }
        const error = url.searchParams.get("error");
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        // state 必须逐字节匹配；不匹配时继续等待，不结束流程。
        if (state !== expected_state) {
          this.respond(response, 400, "OAuth state mismatch");
          return;
        }
        if (error) {
          this.respond(response, 200, `Authorization failed: ${error}`);
          cleanup();
          reject(new Error("OAuth authorization was denied"));
          return;
        }
        if (!code) {
          this.respond(response, 400, "Missing authorization code");
          return;
        }
        this.respond(response, 200, "Authorization complete. You can close this tab.");
        cleanup();
        resolve({ code, redirect_uri: `http://127.0.0.1:${this.port}/callback` });
      };
      const on_abort = () => { cleanup(); reject(new Error("OAuth authorization cancelled")); };
      const cleanup = () => {
        signal?.removeEventListener("abort", on_abort);
        clearTimeout(timer);
        this.server?.off("request", on_request);
      };
      this.server!.on("request", on_request);
      signal?.addEventListener("abort", on_abort, { once: true });
      if (signal?.aborted) on_abort();
    });
  }

  /** 关闭底层监听；等待中的请求会因连接断开而由超时兜底。 */
  async close(): Promise<void> {
    this.lifetime.abort();
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** 生成一次授权流程的随机 state。 */
  static create_state(): string {
    return randomUUID();
  }

  /** 返回一个简单可读的完成页。 */
  private respond(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    response.end(message);
  }
}
