/**
 * RemoteCity：浏览器和 Node 共用的 City HTTP 连接入口。
 * City 拥有凭据和派生 Agent 引用；Agent 发现始终经过服务端授权。
 */
import { RemoteAgentCore } from "./RemoteAgentCore.js";
import { HttpRemoteAgentTransport } from "./transports/HttpRemoteAgentTransport.js";
import type { RemoteCityOptions, RemoteCityAgentInfo } from "@/types/remote/RemoteCity.js";

/** 已确认可访问的远程 Agent。 */
export class RemoteCityAgent extends RemoteAgentCore {
  constructor(readonly info: RemoteCityAgentInfo, transport: HttpRemoteAgentTransport) { super(transport); }
  /** Agent 稳定标识。 */
  get id(): string { return this.info.id; }
  /** Agent 用户可见名称。 */
  get name(): string { return this.info.name; }
  /** Agent 对外能力说明。 */
  get description(): string { return this.info.description; }
}

/** 远程 City 的 Agent 发现入口。 */
class RemoteCityAgents {
  constructor(private readonly city: RemoteCity) {}

  /** 只列出当前凭据允许访问的 Agent。 */
  async list(): Promise<RemoteCityAgentInfo[]> {
    return (await this.city.request("/api/sdk/agents")).agents ?? [];
  }

  /** 查询身份并确认访问权限后返回可执行的 Agent 门面。 */
  async get(agent_id: string): Promise<RemoteCityAgent> {
    const id = agent_id.trim();
    if (!id) throw new Error("Agent ID is required");
    const payload = await this.city.request(`/api/sdk/agents/${encodeURIComponent(id)}`);
    if (!payload.agent) throw new Error("City did not return Agent information");
    return this.city.resolve_agent(payload.agent);
  }
}

/** City HTTP 客户端；连接目标是 City 根地址，无需调用方拼接 Agent 路径。 */
export class RemoteCity {
  readonly agents = new RemoteCityAgents(this);
  private readonly url: string;
  private readonly token?: string;
  private readonly controller = new AbortController();
  private readonly resolved_agents = new Map<string, RemoteCityAgent>();

  constructor(options: RemoteCityOptions) {
    const url = new URL(options.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("RemoteCity requires an HTTP/HTTPS root URL without credentials, query or hash");
    this.url = url.toString().replace(/\/+$/, "");
    this.token = options.token;
  }

  /** 内部发现请求，生命周期跟随 City。 */
  async request(path: string): Promise<{
    /** 当前凭据可访问的列表。 */ agents?: RemoteCityAgentInfo[];
    /** 查询的 Agent。 */ agent?: RemoteCityAgentInfo;
  }> {
    this.controller.signal.throwIfAborted();
    const headers = new Headers();
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const response = await fetch(`${this.url}${path}`, { headers, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)]) });
    const payload = await response.json() as { /** 服务端成功标识。 */ success?: boolean; /** 失败说明。 */ error?: string; /** Agent 列表。 */ agents?: RemoteCityAgentInfo[]; /** Agent 身份。 */ agent?: RemoteCityAgentInfo };
    if (!response.ok || !payload.success) throw new Error(payload.error || `City HTTP ${response.status}`);
    return payload;
  }

  /** 派生 Agent transport；同一 City 内按身份复用门面。 */
  resolve_agent(info: RemoteCityAgentInfo): RemoteCityAgent {
    this.controller.signal.throwIfAborted();
    const existing = this.resolved_agents.get(info.id);
    if (existing) return existing;
    const agent = new RemoteCityAgent(info, new HttpRemoteAgentTransport(`${this.url}/agents/${encodeURIComponent(info.id)}`, this.token));
    this.resolved_agents.set(info.id, agent);
    return agent;
  }

  /** 关闭发现请求和所有已解析 Agent 的执行通道。 */
  async close(): Promise<void> {
    this.controller.abort(new Error("RemoteCity closed"));
    await Promise.all([...this.resolved_agents.values()].map((agent) => agent.close()));
    this.resolved_agents.clear();
  }
}
