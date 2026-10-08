/**
 * AgentChat：Agent 自己那段 Session 的对话面实现。
 *
 * 职责说明（中文）
 * - 只把主对话 Session 的能力投影成对话语义，不持有任何状态。
 * - 所有调用即时转发给 Session：人群语义与执行语义只有一份实现。
 * - 该对象可安全重复创建，不构成需要释放的资源。
 */

import type {
  ListSessionMessagesInput,
  RespondSessionInteractionInput,
  SessionInteractionRequest,
  SessionInteractionResult,
  SessionMessagePage,
  SessionMutationSubscriber,
  SessionMutationUnsubscribe,
  WorkspaceRuntime,
} from "@downcity/type";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { AgentChat as AgentChatContract } from "@/types/agent/AgentChat.js";
import type { AgentSessionPromptInput } from "@/types/sdk/AgentSessionPrompt.js";
import type { AgentSessionStopResult } from "@/types/sdk/AgentSessionStop.js";
import type { AgentSessionTurnHandle } from "@/types/sdk/AgentSessionTurn.js";
import type { AgentSessionStatus } from "@/types/agent/SessionTypes.js";

/** Agent 对话面；转发到承载它的 Session。 */
export class AgentChat implements AgentChatContract {
  readonly session_id: string;

  /** 承载这段对话的 Session。 */
  private readonly session: AgentSession;

  /** 当前对话目录的解析器；主对话可能被切换目录。 */
  private readonly read_workspace: () => WorkspaceRuntime | undefined;

  constructor(input: {
    /** 承载对话的 Session。 */
    readonly session: AgentSession;
    /** 读取该 Session 当前目录。 */
    readonly read_workspace: () => WorkspaceRuntime | undefined;
  }) {
    this.session = input.session;
    this.session_id = input.session.id;
    this.read_workspace = input.read_workspace;
  }

  /** 提交一次用户输入。 */
  async send(input: AgentSessionPromptInput): Promise<AgentSessionTurnHandle> {
    return await this.session.prompt(input);
  }

  /** 读取历史 Message 分页。 */
  async messages(input?: ListSessionMessagesInput): Promise<SessionMessagePage> {
    return await this.session.messages(input);
  }

  /** 订阅后续变化。 */
  subscribe(subscriber: SessionMutationSubscriber): SessionMutationUnsubscribe {
    return this.session.subscribe(subscriber);
  }

  /** 停止当前 Turn。 */
  async stop(): Promise<AgentSessionStopResult> {
    return await this.session.stop();
  }

  /** 列出等待用户响应的 Interaction。 */
  async interactions(): Promise<SessionInteractionRequest[]> {
    return await this.session.interactions();
  }

  /** 提交一个 Interaction 的用户响应。 */
  async respond(input: RespondSessionInteractionInput): Promise<SessionInteractionResult> {
    return await this.session.respond(input);
  }

  /** 读取当前运行与安全状态。 */
  async status(): Promise<AgentSessionStatus> {
    return await this.session.status();
  }

  /** 返回当前目录。 */
  workspace(): WorkspaceRuntime | undefined {
    return this.read_workspace();
  }

  /** 就地切换当前目录。 */
  async set_workspace(workspace?: WorkspaceRuntime): Promise<void> {
    await this.session.set_workspace(workspace);
  }
}
