/**
 * GroupSession：共享群聊上下文与唯一的整轮调度循环。
 *
 * 用户消息立即持久化并进入待处理集合。成员执行期间收集新输入，整轮结束后统一判断；
 * 决策期间有新输入时取消旧判断，只有最新上下文的决定可以启动成员。
 * 检查点只持有尚未消费的消息 ID，恢复、停止与正常执行共用同一条循环。
 */

import { nanoid } from "nanoid";
import type { Agent } from "@/agent/Agent.js";
import type { AgentSession } from "@/types/agent/SessionActor.js";
import type { GroupMessage } from "@/types/group/Group.js";
import type {
  GroupMemberRuntime,
  GroupEventSubscriber,
  GroupEventUnsubscribe,
  GroupPromptInput,
  GroupPromptResult,
  GroupSessionContract,
} from "@/types/group/GroupSession.js";
import type { DispatchDecision, DispatchStrategy } from "@/types/group/DispatchStrategy.js";
import type { ModelClient, WorkspaceRuntime, RespondSessionInteractionInput } from "@downcity/type";
import type { GroupSessionDataStore } from "@/types/group/GroupSessionStore.js";
import {
  GroupDispatchRuntime,
  GroupDispatchStoppedError,
  GroupDispatchSupersededError,
} from "@/group/GroupDispatchRuntime.js";
import type { GroupDispatchResult } from "@/types/group/GroupDispatch.js";
import { normalize_session_title } from "@/session/storage/Metadata.js";
import { generate_session_title } from "@/session/loop/SessionTitle.js";
import { SessionTitleTask } from "@/session/loop/SessionTitleTask.js";

const max_dispatch_rounds = 32;

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
  /** 可选的语言模型，仅用于生成标题；调度使用独立决策策略。 */
  readonly model?: ModelClient;
  /** Group 成员。 */
  readonly members: readonly Agent[];
  /** Group 消息调度策略。 */
  readonly dispatch_strategy: DispatchStrategy;
  /** Group 为成员执行提供的共享 Workspace。 */
  readonly workspace?: WorkspaceRuntime;
}

/** Group 的一个独立群聊上下文。 */
export class GroupSession implements GroupSessionContract {
  readonly id: string;
  readonly group_id: string;
  readonly workspace_id?: string;

  private readonly group_name: string;
  private readonly instruction?: string;
  private readonly model?: ModelClient;
  private readonly members: readonly Agent[];
  private readonly dispatch_runtime: GroupDispatchRuntime;
  private readonly title_task: SessionTitleTask;
  private readonly workspace?: WorkspaceRuntime;
  private readonly messages_by_id: GroupMessage[] = [];
  private readonly subscribers = new Set<GroupEventSubscriber>();
  private readonly member_sessions = new Map<string, AgentSession>();
  private readonly member_session_ids = new Map<string, string>();
  private readonly member_session_promises = new Map<string, Promise<AgentSession>>();
  private readonly member_session_unsubscribes = new Map<string, () => void>();
  private readonly interaction_sessions = new Map<string, AgentSession>();
  private readonly member_running_counts = new Map<string, number>();
  private readonly pending_message_ids = new Set<string>();
  private store?: GroupSessionDataStore;
  private dispatch_loop_promise: Promise<void> | null = null;
  private stop_promise: Promise<void> | null = null;
  private input_revision = 0;
  private stop_requested = false;
  private disposed = false;
  private state_mutation_chain: Promise<void> = Promise.resolve();
  private metadata_mutation_chain: Promise<void> = Promise.resolve();

  constructor(options: GroupSessionOptions) {
    this.id = String(options.id || "").trim();
    this.group_id = String(options.group_id || "").trim();
    if (!this.id) throw new Error("GroupSession requires a non-empty id");
    if (!this.group_id) throw new Error("GroupSession requires a non-empty group_id");
    this.group_name = options.group_name;
    this.instruction = options.instruction;
    this.model = options.model;
    this.members = options.members;
    this.dispatch_runtime = new GroupDispatchRuntime({ dispatch_strategy: options.dispatch_strategy });
    this.title_task = new SessionTitleTask({ session_id: this.id });
    this.workspace = options.workspace;
    this.workspace_id = options.workspace?.id;
  }

  /** 恢复共享消息、成员 Session 和未消费批次，再唤醒唯一循环。 */
  async initialize(store: GroupSessionDataStore): Promise<this> {
    if (this.store && this.store !== store) {
      throw new Error(`GroupSession "${this.id}" is already initialized with another Store`);
    }
    if (this.store === store) return this;
    this.store = store;
    await store.initialize();
    await this.dispatch_runtime.initialize(store);
    const metadata = await store.read_metadata();
    if (metadata.group_id !== this.group_id) {
      throw new Error(`GroupSession "${this.id}" belongs to another Group`);
    }
    const requested_workspace_id = this.workspace?.id;
    if (metadata.workspace_id && metadata.workspace_id !== requested_workspace_id) {
      throw new Error(`GroupSession "${this.id}" requires Workspace "${metadata.workspace_id}"`);
    }
    if (!metadata.workspace_id && requested_workspace_id) {
      await store.update_metadata({ workspace_id: requested_workspace_id });
    }
    this.messages_by_id.push(...await store.list_messages());
    const message_ids = new Set(this.messages_by_id.map((message) => message.id));
    for (const message_id of metadata.pending_message_ids || []) {
      if (message_ids.has(message_id)) this.pending_message_ids.add(message_id);
    }
    const member_session_ids = metadata.member_session_ids || {};
    const valid_member_session_ids: Record<string, string> = {};
    for (const [agent_id, session_id] of Object.entries(member_session_ids)) {
      const member = this.get_member(agent_id);
      if (!member) continue;
      try {
        const session = await member.sessions.get(session_id, "group", {
          ...(this.workspace ? { workspace: this.workspace } : {}),
        });
        this.assert_member_session_origin(session);
        this.member_sessions.set(agent_id, session);
        this.member_session_ids.set(agent_id, session.id);
        this.subscribe_member_session(agent_id, session);
        valid_member_session_ids[agent_id] = session.id;
      } catch {
        // 成员已被删除或 Session 不再匹配时清理映射，继续恢复共享对话。
      }
    }
    if (Object.keys(valid_member_session_ids).length !== Object.keys(member_session_ids).length) {
      await store.update_metadata({ member_session_ids: valid_member_session_ids });
    }
    if (this.pending_message_ids.size > 0) this.request_dispatch();
    return this;
  }

  /** 保存用户消息并唤醒循环；同步使尚未执行的旧判断失效。 */
  async prompt(input: GroupPromptInput): Promise<GroupPromptResult> {
    this.assert_available();
    const text = String(input?.query || "").trim();
    if (!text) throw new Error("group_session.prompt requires a non-empty query");
    const turn_id = `group-turn-${nanoid(12)}`;
    this.input_revision += 1;
    this.dispatch_runtime.supersede();
    await this.run_state_mutation(async () => {
      const message = await this.append_message({ sender_type: "user", sender_id: "user", text, turn_id });
      this.pending_message_ids.add(message.id);
      await this.persist_dispatch_checkpoint();
    });
    this.request_dispatch();
    this.schedule_title_generation();
    return { turn_id, success: true, message_count: this.messages_by_id.length };
  }

  /** 修改当前 GroupSession 的 canonical 用户可见标题。 */
  async rename(input: string): Promise<string> {
    this.assert_available();
    const title = normalize_session_title(input);
    if (!title) throw new Error("group_session.rename requires a non-empty title");
    if (!this.store) throw new Error(`GroupSession "${this.id}" is not initialized`);
    this.title_task.dispose();
    const updated_at = Date.now();
    const changed = await this.run_metadata_mutation(async () => {
      if (!this.store) return false;
      const metadata = await this.store.read_metadata();
      if (normalize_session_title(metadata.title) === title) return false;
      await this.store.update_metadata({ title, updated_at });
      return true;
    });
    if (changed) this.publish_event({ type: "title", title });
    return title;
  }

  /** 读取共享消息快照。 */
  async messages(): Promise<readonly GroupMessage[]> {
    return this.messages_by_id.map((message) => ({ ...message }));
  }

  /** 订阅未来共享消息。 */
  subscribe(subscriber: GroupEventSubscriber): GroupEventUnsubscribe {
    this.assert_available();
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** 将用户响应交给持有对应 Interaction 的成员 Session。 */
  async respond_interaction(input: RespondSessionInteractionInput): Promise<void> {
    const session = this.interaction_sessions.get(input.interaction_id);
    if (!session) throw new Error(`Group interaction not found: ${input.interaction_id}`);
    await session.respond(input);
    this.interaction_sessions.delete(input.interaction_id);
  }

  /** 读取成员运行态快照。 */
  private member_statuses(): readonly GroupMemberRuntime[] {
    return this.members.map((member) => ({
      agent_id: member.id,
      running: (this.member_running_counts.get(member.id) || 0) > 0,
    }));
  }

  /** 停止唯一循环和成员执行，保留已保存消息并清空未消费批次。 */
  async stop(): Promise<void> {
    if (this.disposed) return;
    if (this.stop_promise) return await this.stop_promise;
    this.stop_requested = true;
    this.publish_status(undefined, "stopped");
    this.stop_promise = this.stop_dispatch();
    try {
      await this.stop_promise;
    } finally {
      this.stop_promise = null;
      this.stop_requested = false;
    }
  }

  /** 等待已接受输入落盘、取消正在执行的工作，再提交空检查点。 */
  private async stop_dispatch(): Promise<void> {
    await Promise.allSettled([
      this.dispatch_runtime.stop(),
      ...[...this.member_sessions.values()].map((session) => session.stop()),
    ]);
    await this.state_mutation_chain;
    if (this.dispatch_loop_promise) await this.dispatch_loop_promise.catch(() => undefined);
    await this.run_state_mutation(async () => {
      this.pending_message_ids.clear();
      await this.persist_dispatch_checkpoint();
    });
  }

  /** 释放当前上下文及其成员 Session 引用。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.stop();
    await this.dispatch_runtime.dispose();
    this.title_task.dispose();
    this.disposed = true;
    this.subscribers.clear();
    for (const unsubscribe of this.member_session_unsubscribes.values()) unsubscribe();
    this.member_session_unsubscribes.clear();
    this.interaction_sessions.clear();
    this.member_sessions.clear();
    this.member_session_promises.clear();
    this.member_running_counts.clear();
    this.pending_message_ids.clear();
  }

  /** 唯一调度循环的入口；输入落盘或恢复只唤醒此处，不创建独立用户执行链。 */
  private request_dispatch(): void {
    if (this.stop_requested || this.disposed || this.dispatch_loop_promise) return;
    const loop = this.run_dispatch_loop();
    this.dispatch_loop_promise = loop;
    void loop.then(() => {
      this.dispatch_loop_promise = null;
      if (this.pending_message_ids.size > 0) this.request_dispatch();
    }, () => {
      // 基础存储错误保留检查点，等待显式新输入或重启重试，避免后台无限重试。
      this.dispatch_loop_promise = null;
      if (!this.stop_requested && !this.disposed) this.publish_status(undefined, "failed");
    });
  }

  /** 整轮收齐后处理新增批次；决策时有新输入则保留批次并重新判断。 */
  private async run_dispatch_loop(): Promise<void> {
    let round_count = 0;
    const repeated_paths = new Set<string>();
    while (!this.stop_requested && !this.disposed) {
      await this.state_mutation_chain;
      if (this.stop_requested || this.disposed) return;
      const revision = this.input_revision;
      const context_messages = [...this.messages_by_id];
      const pending_messages = context_messages.filter((message) => this.pending_message_ids.has(message.id));
      // 用户在成员执行期间发来新消息时，优先把该请求作为本轮焦点。
      const message = pending_messages.filter((item) => item.sender_type === "user").at(-1)
        ?? pending_messages.at(-1);
      if (!message) {
        this.publish_status(undefined, "idle");
        return;
      }
      const has_user_input = pending_messages.some((item) => item.sender_type === "user");
      if (has_user_input) {
        round_count = 0;
        repeated_paths.clear();
      }
      const turn_id = context_messages.filter((item) => item.sender_type === "user").at(-1)?.turn_id;
      this.publish_status(turn_id, "dispatching", { message_id: message.id });
      try {
        const dispatch = await this.decide_dispatch(has_user_input ? "user" : "auto", message, pending_messages);
        await this.state_mutation_chain;
        if (this.stop_requested || this.disposed) return;
        // 输入版本在 prompt 入口同步递增，因此消息尚在落盘时也不能执行过期决定。
        if (revision !== this.input_revision) continue;
        const dispatch_key = JSON.stringify({
          member_ids: dispatch.decision.member_ids,
          messages: pending_messages.map((item) => [item.sender_id, item.text]),
        });
        if (dispatch.decision.member_ids.length > 0 && (
          round_count >= max_dispatch_rounds || repeated_paths.has(dispatch_key)
        )) {
          await this.append_dispatch_failure(message, round_count >= max_dispatch_rounds
            ? "Group auto dispatch limit reached."
            : "Group auto dispatch detected a repeated path.");
          await this.complete_dispatch_batch(pending_messages, []);
          continue;
        }
        repeated_paths.add(dispatch_key);
        round_count += 1;
        // 从版本检查到启动本轮没有异步间隙；之后的新输入统一等待本轮结束。
        const outputs = await this.run_dispatch_round(dispatch.decision, message, context_messages, pending_messages, turn_id, dispatch.dispatch_id);
        if (this.stop_requested || this.disposed) return;
        await this.complete_dispatch_batch(pending_messages, outputs);
      } catch (error) {
        if (this.stop_requested || this.disposed || error instanceof GroupDispatchStoppedError) return;
        if (error instanceof GroupDispatchSupersededError || revision !== this.input_revision) continue;
        await this.append_dispatch_failure(message, error);
        await this.complete_dispatch_batch(pending_messages, []);
        this.publish_status(turn_id, "failed");
        if (this.pending_message_ids.size === 0) return;
      }
    }
  }

  /** 原子交接本轮输入和整轮输出，保留执行期间新增的用户消息。 */
  private async complete_dispatch_batch(
    consumed_messages: readonly GroupMessage[],
    outputs: readonly GroupMessage[],
  ): Promise<void> {
    await this.run_state_mutation(async () => {
      for (const message of consumed_messages) this.pending_message_ids.delete(message.id);
      for (const message of outputs) this.pending_message_ids.add(message.id);
      await this.persist_dispatch_checkpoint();
    });
  }

  private async decide_dispatch(
    trigger: "user" | "auto",
    message: GroupMessage,
    pending_messages: readonly GroupMessage[],
  ): Promise<GroupDispatchResult> {
    const pending_ids = new Set(pending_messages.map((item) => item.id));
    return await this.dispatch_runtime.decide({
      group: {
        group_id: this.group_id,
        name: this.group_name,
        ...(this.instruction ? { instruction: this.instruction } : {}),
      },
      trigger,
      current_message: message,
      pending_messages,
      history: this.messages_by_id.filter((item) => !pending_ids.has(item.id)),
      members: this.members.map((member) => ({ agent_id: member.id, name: member.name, description: member.description })),
    });
  }

  /** 并行执行本轮选中成员，收齐整轮回复后才允许下一次成员选择。 */
  private async run_dispatch_round(
    decision: DispatchDecision,
    message: GroupMessage,
    context_messages: readonly GroupMessage[],
    pending_messages: readonly GroupMessage[],
    turn_id?: string,
    dispatch_id?: string,
  ): Promise<GroupMessage[]> {
    const targets = decision.member_ids.map((member_id) => {
      const agent = this.get_member(member_id);
      if (!agent) throw new Error(`Dispatch selected unknown member "${member_id}"`);
      return agent;
    });
    const prepared_results = await Promise.all(targets.map(async (agent) => {
      try {
        return { agent, turn: await this.prepare_member_delivery(agent, message, context_messages, pending_messages) };
      } catch (error) {
        await this.append_member_failure(agent, message, error);
        return null;
      }
    }));
    const prepared_deliveries = prepared_results.filter((item): item is NonNullable<typeof item> => item !== null);
    if (prepared_deliveries.length > 0) {
      this.publish_status(turn_id, "dispatched", {
        message_id: message.id,
        dispatched_member_ids: prepared_deliveries.map(({ agent }) => agent.id),
      });
    }
    const results = await Promise.all(prepared_deliveries.map(({ agent, turn }) => (
      this.execute_member_delivery(agent, message, turn, turn_id, dispatch_id)
    )));
    return results.filter((item): item is GroupMessage => Boolean(item));
  }

  /** 将本轮冻结的上下文提交给成员 Session。 */
  private async prepare_member_delivery(
    agent: Agent,
    message: GroupMessage,
    context_messages: readonly GroupMessage[],
    pending_messages: readonly GroupMessage[],
  ): Promise<Awaited<ReturnType<AgentSession["prompt"]>>> {
    this.assert_available();
    const session = await this.ensure_member_session(agent);
    this.assert_available();
    return await session.prompt({ query: this.build_member_context(agent, message, context_messages, pending_messages) });
  }

  /** 等待成员 Turn 完成，并把有效回复写回 Group。 */
  private async execute_member_delivery(
    agent: Agent,
    message: GroupMessage,
    turn: Awaited<ReturnType<AgentSession["prompt"]>>,
    turn_id?: string,
    dispatch_id?: string,
  ): Promise<GroupMessage | null> {
    this.set_member_running(agent.id, 1, turn_id);
    let running = true;
    try {
      const result = await turn.finished;
      this.set_member_running(agent.id, -1, turn_id);
      running = false;
      if (this.stop_requested || this.disposed) return null;
      if (!result.success) {
        await this.append_member_failure(agent, message, result.error || "未知错误");
        return null;
      }
      if (!result.text?.trim()) {
        await this.append_member_failure(agent, message, "未生成有效回复");
        return null;
      }
      return await this.append_message({
        sender_type: "agent",
        sender_id: agent.id,
        text: result.text.trim(),
        reply_to: message.id,
        ...(turn_id ? { turn_id } : {}),
        ...(dispatch_id ? { dispatch_id } : {}),
      });
    } catch (error) {
      await this.append_member_failure(agent, message, error);
      return null;
    } finally {
      if (running) this.set_member_running(agent.id, -1, turn_id);
    }
  }

  /** 记录真实调度失败，输入更新导致的取消不会进入此处。 */
  private async append_dispatch_failure(message: GroupMessage, error: unknown): Promise<void> {
    if (this.stop_requested || this.disposed) return;
    await this.append_message({
      sender_type: "system",
      sender_id: "system",
      text: error instanceof Error ? error.message : String(error),
      reply_to: message.id,
    });
  }

  /** 把成员自身的投递或执行失败记录为共享事实。 */
  private async append_member_failure(agent: Agent, message: GroupMessage, error: unknown): Promise<void> {
    if (this.stop_requested || this.disposed) return;
    await this.append_message({
      sender_type: "system",
      sender_id: "system",
      text: `${agent.id} 执行失败：${error instanceof Error ? error.message : String(error)}`,
      reply_to: message.id,
    });
  }

  /** 获取或创建一个成员专属的 AgentSession。 */
  private async ensure_member_session(agent: Agent): Promise<AgentSession> {
    const session = this.member_sessions.get(agent.id);
    if (session) return session;
    let create_promise = this.member_session_promises.get(agent.id);
    if (!create_promise) {
      create_promise = this.create_member_session(agent);
      this.member_session_promises.set(agent.id, create_promise);
    }
    try {
      return await create_promise;
    } finally {
      if (this.member_session_promises.get(agent.id) === create_promise) this.member_session_promises.delete(agent.id);
    }
  }

  /** 创建并登记一个成员专属的 AgentSession。 */
  private async create_member_session(agent: Agent): Promise<AgentSession> {
    const session = await agent.sessions.create({
      ...(this.workspace ? { workspace: this.workspace } : {}),
      origin: { type: "group", group_id: this.group_id, group_session_id: this.id },
    });
    this.member_sessions.set(agent.id, session);
    this.member_session_ids.set(agent.id, session.id);
    this.subscribe_member_session(agent.id, session);
    if (!this.store) throw new Error(`GroupSession "${this.id}" is not initialized`);
    await this.store.update_metadata({ member_session_ids: Object.fromEntries(this.member_session_ids) });
    return session;
  }

  /** 校验恢复的成员 Session 确实属于当前 GroupSession。 */
  private assert_member_session_origin(session: AgentSession): void {
    if (session.origin.type !== "group" || session.origin.group_id !== this.group_id || session.origin.group_session_id !== this.id) {
      throw new Error(`Agent Session "${session.id}" does not belong to GroupSession "${this.id}"`);
    }
  }

  /** 转发成员的审批和问答请求，等待状态仍属于本轮执行。 */
  private subscribe_member_session(agent_id: string, session: AgentSession): void {
    this.member_session_unsubscribes.get(agent_id)?.();
    this.member_session_unsubscribes.set(agent_id, session.subscribe((mutation) => {
      if (mutation.variant !== "part" || mutation.type !== "tool") return;
      for (const interaction of mutation.part.interactions ?? []) {
        const registered = this.interaction_sessions.has(interaction.interaction_id);
        if (interaction.status === "pending" && !registered) {
          this.interaction_sessions.set(interaction.interaction_id, session);
          this.publish_event({ type: "interaction", agent_id, request: interaction.request });
        } else if (interaction.status !== "pending" && registered) {
          this.interaction_sessions.delete(interaction.interaction_id);
        }
      }
    }));
  }

  /** 为所有本轮成员使用同一份对话快照，执行中收到的输入留给下一轮。 */
  private build_member_context(
    agent: Agent,
    message: GroupMessage,
    context_messages: readonly GroupMessage[],
    pending_messages: readonly GroupMessage[],
  ): string {
    const pending_ids = new Set(pending_messages.map((item) => item.id));
    const latest_user_message = context_messages.filter((item) => item.sender_type === "user").at(-1);
    const format_message = (item: GroupMessage): string => `${item.sender_type === "user" ? "User" : item.sender_type === "agent" ? item.sender_id : "System"}: ${item.text}`;
    const history = context_messages.filter((item) => !pending_ids.has(item.id))
      .map(format_message).join("\n");
    return [
      `Group: ${this.group_name}`,
      this.instruction ? `Group objective: ${this.instruction}` : "",
      `Your identity: ${agent.name} (${agent.id})`,
      `Your description: ${agent.description || "（未提供）"}`,
      "Group members (only these Agents belong to this Group):",
      ...this.members.map((member) => `- ${member.name} (${member.id}): ${member.description || "（未提供）"}`),
      `Trigger: ${pending_messages.some((item) => item.sender_type === "user") ? "user" : "auto"}`,
      "Latest user request:",
      latest_user_message ? format_message(latest_user_message) : "（无）",
      "New messages for this round:",
      ...pending_messages.map(format_message),
      "Earlier conversation:",
      history || "（无）",
      "Current message:",
      format_message(message),
      "Response constraints:",
      `- 只代表成员 ${agent.id} 自己发言。`,
      "- 最新用户请求优先于群聊长期目标；先直接回应当前问题，避免重复已有回复。",
      "- 问候、确认在线或询问角色时简短回应；这些消息不授权检查目录、创建文档、写代码或启动开发。",
      "- 自动轮次仅处理用户已授权任务中明确尚未完成的工作或其他成员的必要交接；自己的邀请、计划或向用户询问需求不构成继续工作的理由。缺少用户需求时等待用户。",
      "- 群成员仅以以上名单为准；City 的全部 Agent 列表不是本群名单，不凭名单推断成员在线或执行状态。",
      "- 不把历史系统错误解释为当前消息未送达的原因；没有当前证据时不推断故障已恢复。",
      "- 只陈述自己的成果，可以使用其他成员提供的事实继续推进用户目标。",
      "- 不创建队长、裁判、领导者或协调者角色。",
    ].filter(Boolean).join("\n");
  }

  private get_member(agent_id: string): Agent | null {
    return this.members.find((member) => member.id === agent_id) || null;
  }

  /** 更新成员运行计数，并在可见状态发生变化时通知订阅者。 */
  private set_member_running(agent_id: string, delta: 1 | -1, turn_id?: string): void {
    const previous_count = this.member_running_counts.get(agent_id) || 0;
    const next_count = Math.max(0, previous_count + delta);
    if (next_count === 0) this.member_running_counts.delete(agent_id);
    else this.member_running_counts.set(agent_id, next_count);
    if ((previous_count > 0) !== (next_count > 0)) this.publish_status(turn_id, this.stop_requested ? "stopped" : "executing");
  }

  /** 追加共享消息并发布事件；用户入队和整轮交接通过状态事务串行提交。 */
  private async append_message(input: Omit<GroupMessage, "id" | "group_id" | "created_at">): Promise<GroupMessage> {
    const message: GroupMessage = { ...input, id: `group-message-${nanoid(12)}`, group_id: this.group_id, created_at: Date.now() };
    if (!this.store) throw new Error(`GroupSession "${this.id}" is not initialized`);
    await this.store.append_message(message);
    this.messages_by_id.push(message);
    for (const subscriber of this.subscribers) void subscriber({ type: "message", message });
    return message;
  }

  /** 基于首条用户消息异步生成标题，不阻塞 Group 调度主链路。 */
  private schedule_title_generation(): void {
    this.title_task.schedule(async (signal) => {
      if (!this.store || !this.model) return;
      const before_metadata = await this.store.read_metadata();
      if (normalize_session_title(before_metadata.title)) return;
      const first_user_message = this.messages_by_id.find((message) => message.sender_type === "user");
      if (!first_user_message) return;
      const title = await generate_session_title({ model: this.model, session_id: this.id, first_user_text: first_user_message.text, signal });
      if (!title || signal.aborted || !this.store) return;
      const changed = await this.run_metadata_mutation(async () => {
        if (!this.store || signal.aborted) return false;
        const metadata = await this.store.read_metadata();
        const source_exists = this.messages_by_id.some((message) => message.id === first_user_message.id);
        if (normalize_session_title(metadata.title) || !source_exists || signal.aborted) return false;
        await this.store.update_metadata({ title });
        return true;
      });
      if (changed && !signal.aborted) this.publish_event({ type: "title", title });
    });
  }

  /** 串行提交输入与整轮交接，防止新用户消息被旧批次清理覆盖。 */
  private async run_state_mutation<T>(mutation: () => Promise<T>): Promise<T> {
    const task = this.state_mutation_chain.then(mutation, mutation);
    this.state_mutation_chain = task.then(() => undefined, () => undefined);
    return await task;
  }

  /** 串行提交标题修改，避免后台生成覆盖手动重命名。 */
  private async run_metadata_mutation<T>(mutation: () => Promise<T>): Promise<T> {
    const task = this.metadata_mutation_chain.then(mutation, mutation);
    this.metadata_mutation_chain = task.then(() => undefined, () => undefined);
    return await task;
  }

  /** 保存尚未消费的输入；执行期间本轮输入仍在集合中，重启可重新判断。 */
  private async persist_dispatch_checkpoint(): Promise<void> {
    if (this.store) await this.store.update_metadata({ pending_message_ids: [...this.pending_message_ids] });
  }

  /** 发布 Group 阶段和成员运行态。 */
  private publish_status(
    turn_id: string | undefined,
    phase: "idle" | "dispatching" | "dispatched" | "executing" | "stopped" | "failed",
    context?: { /** 触发消息 ID。 */ message_id?: string; /** 本轮参与成员 ID。 */ dispatched_member_ids?: readonly string[] },
  ): void {
    this.publish_event({
      type: "status",
      ...(turn_id ? { turn_id } : {}),
      ...(context?.message_id ? { message_id: context.message_id } : {}),
      ...(context?.dispatched_member_ids ? { dispatched_member_ids: [...context.dispatched_member_ids] } : {}),
      phase,
      members: this.member_statuses(),
    });
  }

  private publish_event(event: Parameters<GroupEventSubscriber>[0]): void {
    for (const subscriber of this.subscribers) void subscriber(event);
  }

  private assert_available(): void {
    if (this.disposed) throw new Error(`GroupSession "${this.id}" is disposed`);
    if (this.stop_requested) throw new Error(`GroupSession "${this.id}" is stopping`);
  }
}
