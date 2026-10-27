/** MCP JSON-RPC transport：stdio 与 Streamable HTTP 的最小统一实现。 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { HttpConnection } from "./HttpConnection.js";
import type { McpOAuthProvider } from "../auth/OAuthSession.js";
import type { McpCallResult, McpHttpTransportConfig, McpStdioTransportConfig, McpToolDefinition } from "@/mcp/types/Mcp.js";

interface JsonRpcResponse {
  /** JSON-RPC 请求 ID。 */
  id?: number;
  /** JSON-RPC 结果。 */
  result?: Record<string, unknown>;
  /** JSON-RPC 错误。 */
  error?: { code?: number; message?: string };
}

interface McpTransport {
  /** 调用 MCP 方法。 */
  request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  /** 发送不等待响应的 MCP 通知。 */
  notify(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<void>;
  /** 关闭底层连接。 */
  close(): Promise<void>;
}

/** MCP server 连接封装。 */
export class McpConnection {
  /** 底层 JSON-RPC transport。 */
  private readonly transport?: McpTransport;
  /** SDK-managed HTTP connection when configured. */
  private readonly http?: HttpConnection;
  /** 是否已完成 MCP 初始化。 */
  private initialized = false;

  constructor(config: McpStdioTransportConfig | McpHttpTransportConfig, cwd?: string, env?: Record<string, string>, oauth?: McpOAuthProvider) {
    if (config.type === "http") {
      this.http = new HttpConnection(config, oauth);
    } else this.transport = new StdioTransport(config, cwd, env);
  }

  /** 初始化 MCP 会话。 */
  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.http) return await this.http.initialize(signal);
    if (this.initialized) return;
    await this.transport!.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "downcity", version: "1.0.0" },
    }, signal);
    await this.transport!.notify("notifications/initialized", {}, signal);
    this.initialized = true;
  }

  /** 获取当前 Server 的全部工具页；支持取消，重复游标按协议错误终止。 */
  async list_tools(signal?: AbortSignal): Promise<McpToolDefinition[]> {
    if (this.http) return await this.http.list_tools(signal);
    signal?.throwIfAborted();
    await this.initialize(signal);
    const tools: McpToolDefinition[] = [];
    const seen_cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      signal?.throwIfAborted();
      const page = await this.transport!.request("tools/list", cursor ? { cursor } : {}, signal);
      signal?.throwIfAborted();
      if (Array.isArray(page.tools)) tools.push(...page.tools as McpToolDefinition[]);
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      if (cursor) {
        if (seen_cursors.has(cursor)) throw new Error("MCP tools/list returned a repeated cursor");
        seen_cursors.add(cursor);
      }
    } while (cursor);
    return tools;
  }

  /** 调用 MCP 工具。 */
  async call_tool(name: string, arguments_value: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    if (this.http) return await this.http.call_tool(name, arguments_value, signal);
    await this.initialize(signal);
    return await this.transport!.request("tools/call", { name, arguments: arguments_value }, signal) as McpCallResult;
  }

  /** 关闭连接。 */
  async close(): Promise<void> {
    if (this.http) await this.http.close();
    await this.transport?.close();
  }
}

/** stdio JSON-RPC transport。 */
class StdioTransport implements McpTransport {
  /** MCP 子进程。 */
  private readonly child: ChildProcessWithoutNullStreams;
  /** 等待响应的请求。 */
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  /** 下一个 JSON-RPC 请求 ID。 */
  private request_id = 0;

  constructor(config: McpStdioTransportConfig, cwd?: string, env?: Record<string, string>) {
    const child_env = { ...process.env, ...(env ?? {}), ...(config.env ?? {}) };
    this.child = spawn(config.command, config.args ?? [], {
      cwd: config.cwd ?? cwd,
      env: child_env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // stderr 必须持续消费，避免输出较多的本地 Server 因管道写满而停住。
    this.child.stderr.resume();
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handle_line(line));
    this.child.on("error", (error) => this.reject_all(error));
    this.child.on("exit", (code, signal) => this.reject_all(new Error(`MCP stdio server exited (${code ?? "signal " + signal})`)));
  }

  request(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const id = ++this.request_id;
    return new Promise((resolve, reject) => {
      const on_abort = () => {
        this.pending.delete(id);
        reject(signal?.reason instanceof Error ? signal.reason : new Error("MCP request aborted"));
      };
      if (signal?.aborted) return on_abort();
      signal?.addEventListener("abort", on_abort, { once: true });
      this.pending.set(id, {
        resolve: (value) => { signal?.removeEventListener("abort", on_abort); resolve(value); },
        reject: (error) => { signal?.removeEventListener("abort", on_abort); reject(error); },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async close(): Promise<void> {
    this.reject_all(new Error("MCP connection closed"));
    if (!this.child.killed) this.child.kill();
  }

  private handle_line(line: string): void {
    try {
      const response = JSON.parse(line) as JsonRpcResponse;
      if (typeof response.id !== "number") return;
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.error) request.reject(new Error(response.error.message || "MCP request failed"));
      else request.resolve(response.result ?? {});
    } catch {
      // stderr/stdout 中的非 JSON 行不应破坏其他请求。
    }
  }

  private reject_all(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

/** 解析可选的配置变量引用。 */
export function resolve_mcp_variables(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => env[name] ?? "");
}
