/**
 * RemoteAgent：统一远程 SDK 客户端。
 *
 * 关键点（中文）
 * - 对外只暴露一个 `url` 入口，不向用户暴露 transport 细节。
 * - 当前内部支持 `http/https` 与 `rpc` 两种访问方式。
 * - `RemoteAgent` 只负责远程访问，不重复实现第二套会话编排器。
 */

import type {
  AgentArchiveSessionInput,
  AgentArchiveSessionsInput,
  AgentArchiveSessionResult,
  AgentArchiveSessionsResult,
  AgentCleanArchiveResult,
  AgentCreateSessionInput,
  AgentListSessionsInput,
  AgentSessionSummaryPage,
} from "@/types/agent/SessionTypes.js";
import type { AgentSessions, RemoteAgentSession } from "@/types/agent/SessionActor.js";
import type { RemoteAgentOptions } from "@/types/agent/RemoteAgentOptions.js";
import type {
  RemoteAgentPluginActionInput,
  RemoteAgentPluginActionResult,
} from "@/types/agent/RemoteAgentPluginAction.js";
import type { RemoteAgentTransport } from "@/remote/RemoteTransport.js";
import { RemoteSession } from "@/remote/RemoteSession.js";
import { create_remote_agent_transport } from "@/remote/TransportFactory.js";

/**
 * RemoteAgent：远程 Agent 客户端。
 */
export class RemoteAgent {
  readonly sessions: AgentSessions<RemoteAgentSession>;

  private readonly transport: RemoteAgentTransport;

  constructor(options: RemoteAgentOptions) {
    const url = String(options.url || "").trim();
    if (!url) {
      throw new Error("RemoteAgent requires a non-empty url");
    }
    this.transport = create_remote_agent_transport(url, options.token);
    this.sessions = new RemoteAgentSessions(this.transport);
  }

  /**
   * 执行远程 Agent runtime 内的 plugin action。
   *
   * 关键点（中文）
   * - 这是 RemoteAgent 顶层能力，不绑定某个 session。
   * - Shell approval 通过具体 RemoteSession 处理。
   */
  async run_plugin_action(
    input: RemoteAgentPluginActionInput,
  ): Promise<RemoteAgentPluginActionResult> {
    const plugin = String(input.plugin || "").trim();
    const action = String(input.action || "").trim();
    if (!plugin) {
      throw new Error("run_plugin_action requires a non-empty plugin");
    }
    if (!action) {
      throw new Error("run_plugin_action requires a non-empty action");
    }
    return await this.transport.run_plugin_action({
      plugin,
      action,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    });
  }

  /**
   * 关闭远程 transport。
   *
   * 关键点（中文）
   * - `rpc://` 会关闭底层长连接。
   * - `http://` / `https://` 没有常驻连接，调用时是安全 no-op。
   */
  async close(): Promise<void> {
    await this.transport.close?.();
  }

}

/**
 * 远程 Agent session 集合入口。
 *
 * 关键点（中文）
 * - `RemoteAgentTransport` 只负责协议传输，不直接暴露为用户 SDK API。
 * - 这里把远程传输包装成和本地 `agent.sessions` 一致的方法命名。
 */
class RemoteAgentSessions implements AgentSessions<RemoteAgentSession> {
  private readonly transport: RemoteAgentTransport;

  constructor(transport: RemoteAgentTransport) {
    this.transport = transport;
  }

  /** 新建一个远程 session。 */
  async create(input?: AgentCreateSessionInput): Promise<RemoteAgentSession> {
    const info = await this.transport.create_session(input);
    return new RemoteSession(this.transport, info);
  }

  /** 获取一个远程 session。 */
  async get(session_id: string): Promise<RemoteAgentSession> {
    const info = await this.transport.get_info(session_id);
    return new RemoteSession(this.transport, info);
  }

  /** 列出远程 session 摘要页。 */
  async list(input?: AgentListSessionsInput): Promise<AgentSessionSummaryPage> {
    return await this.transport.list_sessions(input);
  }

  /** 归档一个远程 session。 */
  async archive(input: AgentArchiveSessionInput): Promise<AgentArchiveSessionResult> {
    return await this.transport.archive_session(input);
  }

  /** 列出远程已归档 session。 */
  async archived(input?: AgentArchiveSessionsInput): Promise<AgentArchiveSessionsResult> {
    return await this.transport.archive_sessions(input);
  }

  /** 永久清空远程已归档 session。 */
  async clean_archive(): Promise<AgentCleanArchiveResult> {
    return await this.transport.clean_archive();
  }
}
