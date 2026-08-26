/**
 * GroupSession：Group 的共享频道/群聊上下文。
 *
 * GroupSession 不执行模型。每次响应都转发给指定成员 Agent 的 AgentSession，
 * 成员结果再作为共享消息回写到当前 GroupSession。
 */

import { nanoid } from "nanoid";
import type { WorkspaceBase } from "@downcity/workspace";
import type { Agent } from "@/agent/Agent.js";
import type { Group } from "@/group/Group.js";
import type {
  GroupMessage,
  GroupMessageSubscriber,
  GroupMessageUnsubscribe,
  GroupSession as GroupSessionContract,
  GroupSessionPromptInput,
  GroupSessionTurnHandle,
  GroupSessionTurnResult,
} from "@/types/group/Group.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";

interface GroupSessionOptions {
  /** 当前 Session 所属 Group。 */
  group: Group;
  /** 当前 Session 可选使用的 Workspace。 */
  workspace?: WorkspaceBase;
  /** Session 释放后的集合回调。 */
  on_dispose: (session_id: string) => void;
}

/** GroupSession 本地实现。 */
export class GroupSessionImpl implements GroupSessionContract {
  readonly id = `group-session-${nanoid(12)}`;
  readonly group_id: string;
  readonly workspace_id?: string;

  private readonly group: Group;
  private readonly workspace?: WorkspaceBase;
  private readonly messages_by_id: GroupMessage[] = [];
  private readonly subscribers = new Set<GroupMessageSubscriber>();
  private readonly member_sessions = new Map<string, AgentSession>();
  /** 每个成员自己的 Session 已同步到的 Group 消息位置。 */
  private readonly member_message_offsets = new Map<string, number>();
  private readonly on_dispose: GroupSessionOptions["on_dispose"];
  private execution_chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: GroupSessionOptions) {
    this.group = options.group;
    this.group_id = options.group.id;
    this.workspace = options.workspace;
    this.workspace_id = options.workspace?.id;
    this.on_dispose = options.on_dispose;
  }

  /** 向 Group 发言并驱动一个成员 Agent 执行。 */
  async prompt(input: GroupSessionPromptInput): Promise<GroupSessionTurnHandle> {
    if (this.disposed) throw new Error(`GroupSession "${this.id}" is disposed`);
    const target_agent = this.resolve_target_agent(input.agent_id);
    const turn_id = `group-turn-${nanoid(12)}`;
    const user_text = prompt_text(input.query);
    let result: GroupSessionTurnResult | null = null;
    let resolve_finished!: (value: GroupSessionTurnResult) => void;
    const finished = new Promise<GroupSessionTurnResult>((resolve) => {
      resolve_finished = resolve;
    });
    const handle: GroupSessionTurnHandle = {
      id: turn_id,
      get result() {
        return result;
      },
      finished,
    };
    const execute = async () => {
      this.append_message({ author_type: "user", text: user_text });
      const member_session = await this.resolve_member_session(target_agent);
      const transcript = this.compose_member_prompt(target_agent.id);
      this.member_message_offsets.set(target_agent.id, this.messages_by_id.length);
      const turn = await member_session.prompt({ query: transcript });
      const member_result = await turn.finished;
      result = {
        turn_id,
        agent_id: target_agent.id,
        text: member_result.text,
        success: member_result.success,
        ...(member_result.error ? { error: member_result.error } : {}),
      };
      this.append_message({
        author_type: "agent",
        author_id: target_agent.id,
        text: member_result.text || member_result.error || "",
      });
      this.member_message_offsets.set(target_agent.id, this.messages_by_id.length);
      resolve_finished(result);
    };
    const queued = this.execution_chain.then(execute, execute);
    this.execution_chain = queued.then(() => undefined, () => undefined);
    void queued.catch((error) => {
      result = {
        turn_id,
        agent_id: target_agent.id,
        text: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      this.append_message({
        author_type: "system",
        text: result.error || "GroupSession turn failed",
      });
      resolve_finished(result);
    });
    return handle;
  }

  /** 读取共享消息历史快照。 */
  messages(): readonly GroupMessage[] {
    return this.messages_by_id.map((message) => ({ ...message }));
  }

  /** 订阅未来共享消息。 */
  subscribe(subscriber: GroupMessageSubscriber): GroupMessageUnsubscribe {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** 停止当前正在执行的成员 AgentSession。 */
  async stop(): Promise<void> {
    await Promise.allSettled(
      [...this.member_sessions.values()].map(async (session) => await session.stop()),
    );
  }

  /** 释放当前 GroupSession。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.stop();
    this.subscribers.clear();
    this.member_sessions.clear();
    this.member_message_offsets.clear();
    this.on_dispose(this.id);
  }

  private resolve_target_agent(agent_id?: string): Agent {
    const resolved_agent_id = String(agent_id || this.group.coordinator_id || "").trim();
    const agent = this.group.get_member(resolved_agent_id);
    if (!agent) throw new Error(`Agent "${resolved_agent_id}" is not a member of Group "${this.group.id}"`);
    return agent;
  }

  private async resolve_member_session(agent: Agent): Promise<AgentSession> {
    const cached = this.member_sessions.get(agent.id);
    if (cached) return cached;
    const session = await agent.sessions.create({ workspace: this.workspace });
    this.member_sessions.set(agent.id, session);
    return session;
  }

  private compose_member_prompt(agent_id: string): string {
    const offset = this.member_message_offsets.get(agent_id) ?? 0;
    const lines = this.messages_by_id.slice(offset).map((message) => {
      const author = message.author_type === "user"
        ? "User"
        : message.author_type === "agent"
          ? message.author_id || "Agent"
          : "System";
      return `${author}: ${message.text}`;
    });
    const group_instruction = this.group.instruction
      ? `Group objective: ${this.group.instruction}`
      : "";
    return [
      group_instruction,
      `You are participating in Group ${this.group.name}.`,
      offset === 0 ? "Shared conversation:" : "New shared messages since your last response:",
      ...lines,
    ].filter(Boolean).join("\n");
  }

  private append_message(input: Omit<GroupMessage, "id" | "created_at">): void {
    const message: GroupMessage = {
      ...input,
      id: `group-message-${nanoid(12)}`,
      created_at: Date.now(),
    };
    this.messages_by_id.push(message);
    for (const subscriber of this.subscribers) subscriber(message);
  }
}

function prompt_text(query: GroupSessionPromptInput["query"]): string {
  if (typeof query === "string") return query;
  return query
    .map((part) => "text" in part ? String(part.text || "") : `[${part.type}]`)
    .join("\n");
}
