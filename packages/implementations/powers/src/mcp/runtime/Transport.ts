/** MCP JSON-RPC transport：stdio 与 Streamable HTTP 的最小统一实现。 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { McpCallResult, McpHttpTransportConfig, McpStdioTransportConfig, McpToolDefinition } from "@/mcp/types/McpPower.js";

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
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  /** 关闭底层连接。 */
  close(): Promise<void>;
}

/** MCP server 连接封装。 */
export class McpConnection {
  /** 底层 JSON-RPC transport。 */
  private readonly transport: McpTransport;
  /** 是否已完成 MCP 初始化。 */
  private initialized = false;

  constructor(config: McpStdioTransportConfig | McpHttpTransportConfig, cwd?: string, env?: Record<string, string>) {
    this.transport = config.type === "stdio"
      ? new StdioTransport(config, cwd, env)
      : new HttpTransport(config);
  }

  /** 初始化 MCP 会话。 */
  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    await this.transport.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "downcity", version: "1.0.0" },
    }, signal);
    await this.transport.notify("notifications/initialized").catch(() => undefined);
    this.initialized = true;
  }

  /** 获取当前 server 的工具清单。 */
  async list_tools(signal?: AbortSignal): Promise<McpToolDefinition[]> {
    await this.initialize(signal);
    const result = await this.transport.request("tools/list", {}, signal);
    return Array.isArray(result.tools) ? result.tools as McpToolDefinition[] : [];
  }

  /** 调用 MCP 工具。 */
  async call_tool(name: string, arguments_value: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    await this.initialize(signal);
    return await this.transport.request("tools/call", { name, arguments: arguments_value }, signal) as McpCallResult;
  }

  /** 关闭连接。 */
  async close(): Promise<void> {
    await this.transport.close();
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

/** Streamable HTTP JSON-RPC transport。 */
class HttpTransport implements McpTransport {
  /** MCP endpoint。 */
  private readonly config: McpHttpTransportConfig;
  /** 下一个 JSON-RPC 请求 ID。 */
  private request_id = 0;

  constructor(config: McpHttpTransportConfig) {
    this.config = config;
  }

  async request(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.request_id, method, params }),
      signal,
    });
    if (!response.ok) throw new Error(`MCP HTTP request failed: ${response.status} ${response.statusText}`);
    const text = await response.text();
    const json = parse_http_response(text);
    if (json.error) throw new Error(json.error.message || "MCP HTTP request failed");
    return json.result ?? {};
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await fetch(this.config.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
  }

  async close(): Promise<void> {
    // Streamable HTTP 无需持有本地连接资源。
  }
}

/** 解析 JSON 或 SSE data 行。 */
function parse_http_response(text: string): JsonRpcResponse {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as JsonRpcResponse;
  const data = trimmed.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
  return JSON.parse(data || "{}");
}

/** 解析可选的配置变量引用。 */
export function resolve_mcp_variables(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => env[name] ?? "");
}

/** 生成连接诊断 ID。 */
export function create_mcp_connection_id(): string {
  return randomUUID();
}
