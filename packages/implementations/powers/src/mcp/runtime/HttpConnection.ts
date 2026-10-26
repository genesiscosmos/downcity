/** SDK-managed Streamable HTTP connection, including initialization, SSE and session headers. */
import { wait_for_mcp } from "./Cancellation.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpHttpTransportConfig, McpCallResult, McpToolDefinition } from "../types/McpPower.js";
import type { McpOAuthProvider } from "../auth/OAuthSession.js";

/** Serializes operations for one endpoint only; authorization cannot block other servers. */
export class HttpConnection {
  /** SDK protocol client for the current MCP session. */
  private client?: Client;
  /** Per-server queue prevents concurrent refresh/login/session resets. */
  private operation: Promise<unknown> = Promise.resolve();
  /** Caller signal belongs to the current operation, never the first connection forever. */
  private active_signal?: AbortSignal;
  /** Disposal cancels both network calls and pending authorization. */
  private readonly lifetime = new AbortController();
  constructor(private readonly config: McpHttpTransportConfig, private readonly oauth?: McpOAuthProvider) {}

  async initialize(signal?: AbortSignal): Promise<void> { await this.run(async () => { await this.connect(signal); }, signal); }
  async list_tools(signal?: AbortSignal): Promise<McpToolDefinition[]> {
    return await this.run(async () => {
      const client = await this.connect(signal);
      const tools: McpToolDefinition[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools({ cursor }, { signal, timeout: 300_000 });
        tools.push(...page.tools as McpToolDefinition[]);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    }, signal);
  }
  async call_tool(name: string, arguments_value: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    return await this.run(async () => {
      const client = await this.connect(signal);
      return await client.callTool({ name, arguments: arguments_value }, undefined, { signal, timeout: 300_000 }) as McpCallResult;
    }, signal);
  }
  async close(): Promise<void> {
    this.lifetime.abort();
    this.oauth?.close();
    const client = this.client;
    this.client = undefined;
    await client?.close();
  }
  private async connect(signal?: AbortSignal): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "downcity", version: "1.0.0" });
    const combined_signal = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
      requestInit: { headers: this.config.headers, redirect: "error" },
      fetch: async (input, init) => {
        const request_signal = AbortSignal.any([this.lifetime.signal, ...(init?.signal ? [init.signal] : []), ...(init?.method === "POST" && this.active_signal ? [this.active_signal] : [])]);
        return await (this.oauth?.fetch ?? fetch)(input, { ...init, signal: request_signal });
      },
    });
    try {
      await client.connect(transport, { signal: combined_signal, timeout: 300_000 });
      combined_signal.throwIfAborted();
      this.client = client;
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }
  private async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const execute = async () => {
      this.lifetime.signal.throwIfAborted();
      signal?.throwIfAborted();
      this.active_signal = signal;
      try { return await operation(); }
      catch (error) {
        // Only an explicit HTTP 404 proves session rejection. Never replay a tool on network ambiguity.
        if (!(error instanceof StreamableHTTPError) || error.code !== 404 || !this.client) throw new Error("MCP HTTP operation failed; reconnect or reauthorize in MCP settings");
        await this.client.close();
        this.client = undefined;
        return await operation();
      } finally { this.active_signal = undefined; }
    };
    const next = this.operation.then(execute, execute);
    this.operation = next.catch(() => undefined);
    return await wait_for_mcp(next, signal);
  }
}
