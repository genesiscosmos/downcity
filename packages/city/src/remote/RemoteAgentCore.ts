/**
 * RemoteAgent 的跨平台会话门面。
 * 只持有 Transport，Node 与浏览器入口各自选择协议，不将 Node 网络依赖带入浏览器。
 */
import { SESSION_ORIGIN_TYPE_WORK } from "@downcity/type";
import type { AgentArchiveSessionInput, AgentArchiveSessionsInput, AgentArchiveSessionResult, AgentArchiveSessionsResult, AgentCleanArchiveResult, AgentCreateSessionInput, AgentListSessionsInput, AgentSessionSummaryPage, AgentSessions, RemoteAgentSession } from "@downcity/agent";
import type { RemoteAgentPowerActionInput, RemoteAgentPowerActionResult } from "@/types/remote/RemoteAgentPowerAction.js";
import type { RemoteAgentTransport } from "./RemoteTransport.js";
import { RemoteSession } from "./RemoteSession.js";

/** 不依赖本地 Agent 实现的远程 SDK。 */
export class RemoteAgentCore {
  readonly sessions: AgentSessions<RemoteAgentSession>;

  constructor(private readonly transport: RemoteAgentTransport) {
    this.sessions = new RemoteAgentSessions(transport);
  }

  /** 直接执行远程 runtime 已注册的 Power Action。 */
  async run_power_action(input: RemoteAgentPowerActionInput): Promise<RemoteAgentPowerActionResult> {
    const power = String(input.power || "").trim();
    const action = String(input.action || "").trim();
    if (!power) throw new Error("run_power_action requires a non-empty power");
    if (!action) throw new Error("run_power_action requires a non-empty action");
    return await this.transport.run_power_action({ power, action, ...(input.payload !== undefined ? { payload: input.payload } : {}) });
  }

  /** 释放 Transport 拥有的连接。 */
  async close(): Promise<void> { await this.transport.close?.(); }
}

/** 每个 SDK 实例拥有自己的创建监听器，Session 状态由服务端拥有。 */
class RemoteAgentSessions implements AgentSessions<RemoteAgentSession> {
  private readonly creation_listeners = new Set<(session: RemoteAgentSession) => void | Promise<void>>();

  constructor(private readonly transport: RemoteAgentTransport) {}

  async create(input?: AgentCreateSessionInput): Promise<RemoteAgentSession> {
    const info = await this.transport.create_session(input);
    const session = new RemoteSession(this.transport, info);
    await Promise.allSettled([...this.creation_listeners].map(async (listener) => await listener(session)));
    return session;
  }

  on_created(listener: (session: RemoteAgentSession) => void | Promise<void>): () => void {
    this.creation_listeners.add(listener);
    return () => { this.creation_listeners.delete(listener); };
  }

  async get(session_id: string, origin_type = SESSION_ORIGIN_TYPE_WORK): Promise<RemoteAgentSession> {
    return new RemoteSession(this.transport, await this.transport.get_info(session_id, origin_type));
  }

  async list(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage> { return await this.transport.list_sessions(input); }
  async archive(input: AgentArchiveSessionInput): Promise<AgentArchiveSessionResult> { return await this.transport.archive_session(input); }
  async archived(input?: AgentArchiveSessionsInput): Promise<AgentArchiveSessionsResult> { return await this.transport.archive_sessions(input); }
  async clean_archive(): Promise<AgentCleanArchiveResult> { return await this.transport.clean_archive(); }
}
