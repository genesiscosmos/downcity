/** GroupSession：一次 Group 群聊上下文的运行时实现。 */

import { nanoid } from "nanoid";
import type { Agent } from "@/agent/Agent.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { GroupMember, GroupMessage } from "@/types/group/Group.js";
import type {
  GroupMessageSubscriber,
  GroupMessageUnsubscribe,
  GroupPromptInput,
  GroupSessionContract,
} from "@/types/group/GroupSession.js";
import type { AttentionPolicy } from "@/types/group/AttentionPolicy.js";
import type { WorkspaceBase } from "@downcity/workspace";
import type { GroupSessionDataStore } from "@/types/group/GroupSessionStore.js";

const max_delivery_depth = 32;

/** GroupSession 的创建依赖。 */
export interface GroupSessionOptions {
  /** 当前群聊上下文的稳定标识。 */
  readonly id: string;
  /** 所属 Group 的稳定标识。 */
  readonly group_id: string;
  /** Group 展示名称。 */
  readonly group_name: string;
  /** Group 协作说明。 */
  readonly instruction?: string;
  /** Group 成员。 */
  readonly members: readonly GroupMember[];
  /** Group 注意力策略。 */
  readonly attention_policy: AttentionPolicy;
  /** Group 为成员执行提供的共享 Workspace。 */
  readonly workspace?: WorkspaceBase;
}

/** Group 的一个独立群聊上下文。 */
export class GroupSession implements GroupSessionContract {
  readonly id: string;
  readonly group_id: string;
  readonly workspace_id?: string;

  private readonly group_name: string;
  private readonly instruction?: string;
  private readonly members: readonly GroupMember[];
  private readonly attention_policy: AttentionPolicy;
  private readonly workspace?: WorkspaceBase;
  private readonly messages_by_id: GroupMessage[] = [];
  private readonly subscribers = new Set<GroupMessageSubscriber>();
  private readonly member_sessions = new Map<string, AgentSession>();
  private readonly member_session_ids = new Map<string, string>();
  private readonly member_running = new Set<string>();
  private readonly pending_deliveries = new Set<Promise<void>>();
  private store?: GroupSessionDataStore;
  private prompt_tail: Promise<void> = Promise.resolve();
  private stop_requested = false;
  private disposed = false;

  constructor(options: GroupSessionOptions) {
    this.id = String(options.id || "").trim();
    this.group_id = String(options.group_id || "").trim();
    if (!this.id) throw new Error("GroupSession requires a non-empty id");
    if (!this.group_id) throw new Error("GroupSession requires a non-empty group_id");
    this.group_name = options.group_name;
    this.instruction = options.instruction;
    this.members = options.members;
    this.attention_policy = options.attention_policy;
    this.workspace = options.workspace;
    this.workspace_id = options.workspace?.id;
  }

  /** 从持久化 Store 初始化当前 GroupSession 的消息历史。 */
  async initialize(store: GroupSessionDataStore): Promise<this> {
    if (this.store && this.store !== store) {
      throw new Error(`GroupSession "${this.id}" is already initialized with another Store`);
    }
    if (this.store === store) return this;
    this.store = store;
    await store.initialize();
    const metadata = await store.read_metadata();
    if (metadata.group_id !== this.group_id) {
      throw new Error(`GroupSession "${this.id}" belongs to another Group`);
    }
    const requested_workspace_id = this.workspace?.id;
    if (metadata.workspace_id && metadata.workspace_id !== requested_workspace_id) {
      throw new Error(
        `GroupSession "${this.id}" requires Workspace "${metadata.workspace_id}"`,
      );
    }
    if (!metadata.workspace_id && requested_workspace_id) {
      await store.update_metadata({ workspace_id: requested_workspace_id });
    }
    this.messages_by_id.push(...await store.list_messages());
    const member_session_ids = metadata.member_session_ids || {};
    const valid_member_session_ids: Record<string, string> = {};
    for (const [agent_id, session_id] of Object.entries(member_session_ids)) {
      const member = this.get_member(agent_id);
      if (!member) continue;
      try {
        const session = await member.sessions.get(session_id, {
          ...(this.workspace ? { workspace: this.workspace } : {}),
          origin: {
            type: "group",
            group_id: this.group_id,
            group_session_id: this.id,
          },
        });
        this.member_sessions.set(agent_id, session);
        this.member_session_ids.set(agent_id, session.id);
        valid_member_session_ids[agent_id] = session.id;
      } catch {
        // 成员已被删除或其 Session 不再匹配时，清理失效映射并继续恢复群聊。
      }
    }
    if (Object.keys(valid_member_session_ids).length !== Object.keys(member_session_ids).length) {
      await store.update_metadata({ member_session_ids: valid_member_session_ids });
    }
    return this;
  }

  /** 追加用户消息并异步开始群聊传播。 */
  async prompt(input: GroupPromptInput): Promise<void> {
    this.assert_available();
    const text = String(input?.query || "").trim();
    if (!text) throw new Error("group_session.prompt requires a non-empty query");
    const delivery = this.prompt_tail.then(async () => {
      if (this.stop_requested || this.disposed) return;
      const message = await this.append_message({ sender_type: "user", sender_id: "user", text });
      try {
        await this.deliver_message(message);
      } catch (error) {
        if (this.stop_requested || this.disposed) return;
        await this.append_message({
          sender_type: "system",
          sender_id: "system",
          text: error instanceof Error ? error.message : String(error),
          reply_to: message.id,
        });
      }
    });
    this.prompt_tail = delivery.catch(() => undefined);
    this.pending_deliveries.add(delivery);
    try {
      await delivery;
    } finally {
      this.pending_deliveries.delete(delivery);
    }
  }

  /** 读取共享消息快照。 */
  async messages(): Promise<readonly GroupMessage[]> {
    return this.messages_by_id.map((message) => ({ ...message }));
  }

  /** 订阅未来共享消息。 */
  subscribe(subscriber: GroupMessageSubscriber): GroupMessageUnsubscribe {
    this.assert_available();
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** 读取成员运行态；成员是否回复由成员自身决定。 */
  member_statuses() {
    return this.members.map((member) => ({
      agent_id: member.agent.id,
      running: this.member_running.has(member.agent.id),
    }));
  }

  /** 停止当前传播和成员执行。 */
  async stop(): Promise<void> {
    if (this.disposed) return;
    this.stop_requested = true;
    await Promise.allSettled([...this.member_sessions.values()].map((session) => session.stop()));
    await Promise.allSettled([...this.pending_deliveries]);
    this.stop_requested = false;
  }

  /** 释放当前上下文及其成员 Session 引用。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.stop();
    this.disposed = true;
    this.subscribers.clear();
    this.member_sessions.clear();
    this.member_running.clear();
  }

  private async deliver_message(message: GroupMessage, depth = 0): Promise<void> {
    if (this.stop_requested || this.disposed) return;
    if (depth >= max_delivery_depth) {
      await this.append_message({
        sender_type: "system",
        sender_id: "system",
        text: "Group message propagation limit reached.",
        reply_to: message.id,
      });
      return;
    }
    const decision = await this.attention_policy.decide_attention({
      message,
      messages: await this.messages(),
      members: this.members,
    });
    const targets = [...new Set(decision.member_ids)]
      .map((agent_id) => this.get_member(agent_id))
      .filter((agent): agent is Agent => Boolean(agent));
    await Promise.all(targets.map((agent) => this.deliver_to_member(agent, message, depth)));
  }

  private async deliver_to_member(agent: Agent, message: GroupMessage, depth: number): Promise<void> {
    if (this.stop_requested || this.disposed) return;
    let session = this.member_sessions.get(agent.id);
    if (!session) {
      session = await agent.sessions.create({
        ...(this.workspace ? { workspace: this.workspace } : {}),
        origin: {
          type: "group",
          group_id: this.group_id,
          group_session_id: this.id,
        },
      });
      this.member_sessions.set(agent.id, session);
      this.member_session_ids.set(agent.id, session.id);
      const store = this.store;
      if (!store) throw new Error(`GroupSession "${this.id}" is not initialized`);
      await store.update_metadata({
        member_session_ids: Object.fromEntries(this.member_session_ids),
      });
    }
    this.member_running.add(agent.id);
    try {
      const turn = await session.prompt({ query: this.build_member_context(message) });
      const result = await turn.finished;
      if (!result.success || !result.text?.trim() || this.stop_requested || this.disposed) return;
      const reply = await this.append_message({
        sender_type: "agent",
        sender_id: agent.id,
        text: result.text.trim(),
        reply_to: message.id,
      });
      await this.deliver_message(reply, depth + 1);
    } finally {
      this.member_running.delete(agent.id);
    }
  }

  private build_member_context(message: GroupMessage): string {
    const history = this.messages_by_id
      .filter((item) => item.id !== message.id)
      .map((item) => `${item.sender_type === "user" ? "User" : item.sender_id}: ${item.text}`)
      .join("\n");
    return [
      this.instruction ? `Group objective: ${this.instruction}` : "",
      `You are a member of Group ${this.group_name}.`,
      "Group conversation:",
      history,
      `Current message from ${message.sender_type === "agent" ? message.sender_id : "user"}: ${message.text}`,
      "Decide yourself whether to reply. If no reply is needed, return an empty response.",
    ].filter(Boolean).join("\n");
  }

  private get_member(agent_id: string): Agent | null {
    return this.members.find((member) => member.agent.id === agent_id)?.agent || null;
  }

  private async append_message(input: Omit<GroupMessage, "id" | "group_id" | "created_at">): Promise<GroupMessage> {
    const message: GroupMessage = {
      ...input,
      id: `group-message-${nanoid(12)}`,
      group_id: this.group_id,
      created_at: Date.now(),
    };
    if (!this.store) throw new Error(`GroupSession "${this.id}" is not initialized`);
    await this.store.append_message(message);
    this.messages_by_id.push(message);
    for (const subscriber of this.subscribers) void subscriber(message);
    return message;
  }

  private assert_available(): void {
    if (this.disposed) throw new Error(`GroupSession "${this.id}" is disposed`);
    if (this.stop_requested) throw new Error(`GroupSession "${this.id}" is stopping`);
  }
}
