/** GroupSession：一次 Group 群聊上下文的运行时实现。 */

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
  GroupTurnRuntime,
  GroupSessionContract,
} from "@/types/group/GroupSession.js";
import type {
  DispatchAssignment,
  DispatchDecision,
  DispatchStage,
  DispatchStrategy,
} from "@/types/group/DispatchStrategy.js";
import type { WorkspaceRuntime } from "@downcity/type";
import type { AgentModel } from "@/agent/AgentModel.js";
import type { GroupSessionDataStore } from "@/types/group/GroupSessionStore.js";
import type { RespondSessionInteractionInput } from "@/types/session/SessionInteraction.js";
import {
  GroupDispatchRuntime,
  GroupDispatchStoppedError,
} from "@/group/GroupDispatchRuntime.js";
import type { GroupDispatchResult } from "@/types/group/GroupDispatch.js";
import { normalize_session_title } from "@/session/storage/Metadata.js";
import { generate_session_title } from "@/session/SessionTitle.js";
import { SessionTitleTask } from "@/session/runtime/SessionTitleTask.js";

const max_auto_dispatch_count = 32;

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
  /** GroupSession 用于生成标题的 Group 模型。 */
  readonly model?: AgentModel;
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
  private readonly model?: AgentModel;
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
  private readonly pending_deliveries = new Set<Promise<void>>();
  private readonly active_member_deliveries = new Set<Promise<void>>();
  private readonly group_turns_by_id = new Map<string, GroupTurnRuntime>();
  private readonly consumed_auto_message_ids = new Set<string>();
  private readonly auto_dispatch_path_keys = new Set<string>();
  private auto_frontier_messages: readonly GroupMessage[] = [];
  private store?: GroupSessionDataStore;
  private auto_dispatch_promise: Promise<void> | null = null;
  private auto_dispatch_requested = false;
  private stop_requested = false;
  private disposed = false;
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
    this.dispatch_runtime = new GroupDispatchRuntime({
      dispatch_strategy: options.dispatch_strategy,
    });
    this.title_task = new SessionTitleTask({ session_id: this.id });
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
    await this.dispatch_runtime.initialize(store);
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
    for (const message of this.messages_by_id) this.consumed_auto_message_ids.add(message.id);
    const pending_turns = metadata.pending_turns || [];
    const pending_turn_ids = new Set(pending_turns.map((item) => item.turn_id));
    for (const checkpoint of pending_turns) {
      this.group_turns_by_id.set(checkpoint.turn_id, {
        turn_id: checkpoint.turn_id,
        root_message_id: checkpoint.root_message_id,
        context_message_ids: checkpoint.context_message_ids,
        dispatch_stage: checkpoint.dispatch_stage,
        auto_pending: checkpoint.dispatch_stage === "auto",
        stopped: false,
        recovered: true,
      });
    }
    for (const message of this.messages_by_id) {
      if (message.sender_type === "agent" && message.turn_id && pending_turn_ids.has(message.turn_id)) {
        this.consumed_auto_message_ids.delete(message.id);
      }
    }
    this.auto_frontier_messages = (metadata.auto_frontier_message_ids || [])
      .map((message_id) => this.messages_by_id.find((message) => message.id === message_id))
      .filter((message): message is GroupMessage => Boolean(message));
    for (const message of this.auto_frontier_messages) this.consumed_auto_message_ids.delete(message.id);
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
        // 成员已被删除或其 Session 不再匹配时，清理失效映射并继续恢复群聊。
      }
    }
    if (Object.keys(valid_member_session_ids).length !== Object.keys(member_session_ids).length) {
      await store.update_metadata({ member_session_ids: valid_member_session_ids });
    }
    for (const group_turn of this.group_turns_by_id.values()) {
      if (group_turn.dispatch_stage !== "user") continue;
      const message = this.messages_by_id.find((item) => item.id === group_turn.root_message_id);
      if (message) this.start_user_dispatch(message, group_turn);
    }
    if ([...this.group_turns_by_id.values()].some((turn) => turn.auto_pending) || this.auto_frontier_messages.length > 0) {
      this.request_auto_dispatch();
    }
    return this;
  }

  /** 立即追加用户消息，并异步触发本条消息的初始调度。 */
  async prompt(input: GroupPromptInput): Promise<GroupPromptResult> {
    this.assert_available();
    const text = String(input?.query || "").trim();
    if (!text) throw new Error("group_session.prompt requires a non-empty query");
    const turn_id = `group-turn-${nanoid(12)}`;
    const context_message_ids = this.messages_by_id.map((message) => message.id);
    const message = await this.append_message({ sender_type: "user", sender_id: "user", text, turn_id });
    const group_turn: GroupTurnRuntime = {
      turn_id,
      root_message_id: message.id,
      context_message_ids: [...context_message_ids, message.id],
      dispatch_stage: "user",
      auto_pending: false,
      stopped: false,
    };
    this.group_turns_by_id.set(turn_id, group_turn);
    await this.persist_dispatch_checkpoint();
    this.publish_status(turn_id, "dispatching", { message_id: message.id });
    this.start_user_dispatch(message, group_turn);
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

  async respond_interaction(input: RespondSessionInteractionInput): Promise<void> {
    const session = this.interaction_sessions.get(input.interaction_id);
    if (!session) throw new Error(`Group interaction not found: ${input.interaction_id}`);
    await session.respond(input);
    this.interaction_sessions.delete(input.interaction_id);
  }

  /** 读取成员运行态快照；成员是否回复由成员自身决定。 */
  private member_statuses(): readonly GroupMemberRuntime[] {
    return this.members.map((member) => ({
      agent_id: member.id,
      running: (this.member_running_counts.get(member.id) || 0) > 0,
    }));
  }

  /** 停止当前传播和成员执行。 */
  async stop(): Promise<void> {
    if (this.disposed) return;
    this.stop_requested = true;
    this.publish_status(undefined, "stopped");
    await Promise.allSettled([
      this.dispatch_runtime.stop(),
      ...[...this.member_sessions.values()].map((session) => session.stop()),
    ]);
    await Promise.allSettled([...this.pending_deliveries]);
    if (this.auto_dispatch_promise) await this.auto_dispatch_promise;
    this.auto_dispatch_requested = false;
    this.auto_frontier_messages = [];
    this.group_turns_by_id.clear();
    this.auto_dispatch_path_keys.clear();
    await this.persist_dispatch_checkpoint();
    this.stop_requested = false;
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
    this.group_turns_by_id.clear();
    this.consumed_auto_message_ids.clear();
    this.auto_frontier_messages = [];
    this.auto_dispatch_path_keys.clear();
  }

  private async run_user_dispatch(message: GroupMessage, turn_id: string): Promise<void> {
    const group_turn = this.group_turns_by_id.get(turn_id);
    if (!group_turn) return;
    try {
      const dispatch = await this.decide_dispatch("user", message, [message]);
      const context_messages = group_turn.context_message_ids
        .map((message_id) => this.messages_by_id.find((item) => item.id === message_id))
        .filter((item): item is GroupMessage => Boolean(item));
      await this.run_dispatch_plan(
        dispatch.decision,
        message,
        context_messages,
        turn_id,
        dispatch.dispatch_id,
      );
      if (this.stop_requested || this.disposed) {
        group_turn.stopped = true;
        this.group_turns_by_id.delete(turn_id);
        await this.persist_dispatch_checkpoint();
        return;
      }
      if (dispatch.decision.terminal) {
        this.group_turns_by_id.delete(turn_id);
      } else {
        group_turn.dispatch_stage = "auto";
        group_turn.auto_pending = true;
      }
      await this.persist_dispatch_checkpoint();
      if (dispatch.decision.terminal) this.publish_status(turn_id, "idle");
    } catch (error) {
      group_turn.stopped = this.stop_requested;
      if (!(error instanceof GroupDispatchStoppedError)) {
        await this.append_dispatch_failure(message, error);
      }
      this.group_turns_by_id.delete(turn_id);
      await this.persist_dispatch_checkpoint();
      this.publish_status(turn_id, this.stop_requested ? "stopped" : "failed");
    }
  }

  /** 登记一次用户调度运行；新建和恢复必须经过同一个生命周期入口。 */
  private start_user_dispatch(message: GroupMessage, group_turn: GroupTurnRuntime): void {
    const dispatch = this.run_user_dispatch(message, group_turn.turn_id);
    group_turn.user_dispatch = dispatch;
    this.pending_deliveries.add(dispatch);
    void dispatch.finally(() => {
      this.pending_deliveries.delete(dispatch);
      if (group_turn.auto_pending) this.request_auto_dispatch();
    });
  }

  /** GroupSession 唯一的自动调度循环，统一消费已完成成员产生的新消息。 */
  private request_auto_dispatch(): void {
    if (this.stop_requested || this.disposed) return;
    this.auto_dispatch_requested = true;
    if (this.auto_dispatch_promise) return;
    this.auto_dispatch_promise = this.run_auto_dispatch().finally(() => {
      this.auto_dispatch_promise = null;
      if (this.auto_dispatch_requested && !this.stop_requested && !this.disposed) this.request_auto_dispatch();
    });
  }

  private async run_auto_dispatch(): Promise<void> {
    let frontier_messages: readonly GroupMessage[] = this.auto_frontier_messages;
    let dispatch_count = 0;
    if (frontier_messages.length === 0 && [...this.group_turns_by_id.values()].some((group_turn) => group_turn.auto_pending)) {
      this.auto_dispatch_path_keys.clear();
    }
    while (this.auto_dispatch_requested && !this.stop_requested && !this.disposed) {
      this.auto_dispatch_requested = false;
      if (frontier_messages.length > 0) {
        if (++dispatch_count > max_auto_dispatch_count) {
          await this.append_message({ sender_type: "system", sender_id: "system", text: "Group auto dispatch limit reached." });
          return;
        }
        const message = frontier_messages[frontier_messages.length - 1];
        this.publish_status(undefined, "dispatching", { message_id: message.id });
        try {
          const dispatch = await this.decide_dispatch("auto", message, frontier_messages);
          const dispatch_key = JSON.stringify(dispatch.decision);
          if (this.auto_dispatch_path_keys.has(dispatch_key)) {
            await this.append_message({ sender_type: "system", sender_id: "system", text: "Group auto dispatch detected a repeated path.", reply_to: message.id });
            frontier_messages = [];
            this.auto_frontier_messages = [];
            this.auto_dispatch_path_keys.clear();
            await this.persist_dispatch_checkpoint();
            this.publish_status(undefined, "idle");
            continue;
          }
          this.auto_dispatch_path_keys.add(dispatch_key);
          frontier_messages = await this.run_dispatch_plan(
            dispatch.decision,
            message,
            this.messages_by_id,
            undefined,
            dispatch.dispatch_id,
          );
          if (dispatch.decision.terminal || frontier_messages.length === 0) {
            frontier_messages = [];
            this.auto_frontier_messages = [];
            this.auto_dispatch_path_keys.clear();
            await this.persist_dispatch_checkpoint();
            this.publish_status(undefined, "idle");
          } else {
            this.auto_frontier_messages = frontier_messages;
            await this.persist_dispatch_checkpoint();
            this.auto_dispatch_requested = true;
          }
        } catch (error) {
          if (error instanceof GroupDispatchStoppedError) return;
          await this.append_dispatch_failure(message, error);
          this.publish_status(undefined, "failed");
          frontier_messages = [];
          this.auto_frontier_messages = [];
          this.auto_dispatch_path_keys.clear();
          await this.persist_dispatch_checkpoint();
        }
        continue;
      }
      // 一个 auto dispatch 负责一个已经收口的输入批次；先等待当下已排队的
      // user dispatch，避免第一条输入完成后抢先消费，导致并发输入被拆散。
      const pending_deliveries = [...this.pending_deliveries];
      if (pending_deliveries.length > 0) {
        await Promise.allSettled(pending_deliveries);
        this.auto_dispatch_requested = true;
        continue;
      }
      const batch_turns = [...this.group_turns_by_id.values()].filter((group_turn) => group_turn.auto_pending);
      const batch_turn_ids = new Set(batch_turns.map((group_turn) => group_turn.turn_id));
      const pending_messages = this.messages_by_id
        .filter((message) => (
          message.turn_id && batch_turn_ids.has(message.turn_id) &&
          message.sender_type === "agent" &&
          !this.consumed_auto_message_ids.has(message.id)
        ));
      const candidate_messages = pending_messages;
      if (candidate_messages.length === 0) {
        if (this.pending_deliveries.size === 0 && this.active_member_deliveries.size === 0) {
          for (const group_turn of batch_turns) this.group_turns_by_id.delete(group_turn.turn_id);
          await this.persist_dispatch_checkpoint();
          this.publish_status(undefined, "idle");
        }
        continue;
      }
      batch_turns.forEach((group_turn) => { group_turn.auto_pending = false; });
      for (const message of candidate_messages) this.consumed_auto_message_ids.add(message.id);
      await this.persist_dispatch_checkpoint();
      dispatch_count = 0;
      const message = candidate_messages[candidate_messages.length - 1];
      this.publish_status(undefined, "dispatching", { message_id: message.id });
      try {
        const dispatch = await this.decide_dispatch("auto", message, pending_messages);
        const context_messages = this.messages_by_id.filter((item) => item.turn_id && batch_turn_ids.has(item.turn_id));
        const outputs = await this.run_dispatch_plan(
          dispatch.decision,
          message,
          context_messages,
          undefined,
          dispatch.dispatch_id,
        );
        for (const turn_id of batch_turn_ids) this.group_turns_by_id.delete(turn_id);
        if (dispatch.decision.terminal || outputs.length === 0) {
          this.auto_frontier_messages = [];
          await this.persist_dispatch_checkpoint();
          this.publish_status(undefined, "idle");
        } else {
          frontier_messages = outputs;
          this.auto_frontier_messages = outputs;
          await this.persist_dispatch_checkpoint();
          this.auto_dispatch_requested = true;
        }
      } catch (error) {
        if (error instanceof GroupDispatchStoppedError) return;
        await this.append_dispatch_failure(message, error);
        this.publish_status(undefined, "failed");
        for (const turn_id of batch_turn_ids) this.group_turns_by_id.delete(turn_id);
        this.auto_frontier_messages = [];
        await this.persist_dispatch_checkpoint();
      }
    }
  }

  private async decide_dispatch(
    trigger: "user" | "auto",
    message: GroupMessage,
    pending_messages: readonly GroupMessage[],
  ): Promise<GroupDispatchResult> {
    const pending_message_ids = new Set(pending_messages.map((item) => item.id));
    return await this.dispatch_runtime.decide({
      group: {
        group_id: this.group_id,
        name: this.group_name,
        ...(this.instruction ? { instruction: this.instruction } : {}),
      },
      trigger,
      current_message: message,
      pending_messages,
      history: this.messages_by_id.filter((item) => !pending_message_ids.has(item.id)),
      members: this.members.map((member) => ({
        agent_id: member.id,
        name: member.name,
        description: member.description,
      })),
    });
  }

  /** 顺序执行有限阶段计划；任一阶段没有有效输出时不再执行后续阶段。 */
  private async run_dispatch_plan(
    decision: DispatchDecision,
    source_message: GroupMessage,
    base_messages: readonly GroupMessage[],
    turn_id?: string,
    dispatch_id?: string,
  ): Promise<readonly GroupMessage[]> {
    const completed_outputs: GroupMessage[] = [];
    let stage_outputs: readonly GroupMessage[] = [];
    for (const [stage_index, stage] of decision.stages.entries()) {
      const current_message = stage_index === 0
        ? source_message
        : stage_outputs.at(-1) || source_message;
      stage_outputs = await this.execute_dispatch_stage(
        stage,
        current_message,
        [...base_messages, ...completed_outputs],
        turn_id,
        dispatch_id,
      );
      if (stage_outputs.length === 0) return [];
      completed_outputs.push(...stage_outputs);
    }
    // 只有最后阶段是下一轮语义判断的 frontier；此前阶段已经被后续成员消费。
    return stage_outputs;
  }

  /** 并行执行一个阶段内的成员专属任务。 */
  private async execute_dispatch_stage(
    stage: DispatchStage,
    message: GroupMessage,
    context_messages: readonly GroupMessage[],
    turn_id?: string,
    dispatch_id?: string,
  ): Promise<GroupMessage[]> {
    const targets = stage.assignments.map((assignment) => {
      const agent = this.get_member(assignment.member_id);
      if (!agent) throw new Error(`Dispatch selected unknown member "${assignment.member_id}"`);
      return { agent, assignment };
    });
    const prepared_results = await Promise.all(targets.map(async ({ agent, assignment }) => {
      try {
        return {
          agent,
          turn: await this.prepare_member_delivery(agent, message, context_messages, assignment),
        } as const;
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
    const execution_results = Promise.all(prepared_deliveries.map(({ agent, turn }) => (
      this.execute_member_delivery(agent, message, turn, turn_id, dispatch_id, stage.stage_id)
    )));
    const execution = execution_results.then(() => undefined);
    this.active_member_deliveries.add(execution);
    try {
      await execution;
    } finally {
      this.active_member_deliveries.delete(execution);
    }
    return (await execution_results).filter((item): item is GroupMessage => Boolean(item));
  }

  /** 将消息提交给成员 Session，并返回已经接受的 Turn 句柄。 */
  private async prepare_member_delivery(
    agent: Agent,
    message: GroupMessage,
    context_messages: readonly GroupMessage[],
    assignment: DispatchAssignment,
  ): Promise<Awaited<ReturnType<AgentSession["prompt"]>>> {
    if (this.stop_requested || this.disposed) {
      throw new Error(`GroupSession "${this.id}" is stopping`);
    }
    const session = await this.ensure_member_session(agent);
    return await session.prompt({
      query: this.build_member_context(agent, message, context_messages, assignment.instruction),
    });
  }

  /** 等待成员 Turn 完成，并把有效回复写回 Group。 */
  private async execute_member_delivery(
    agent: Agent,
    message: GroupMessage,
    turn: Awaited<ReturnType<AgentSession["prompt"]>>,
    turn_id?: string,
    dispatch_id?: string,
    dispatch_stage_id?: string,
  ): Promise<GroupMessage | null> {
    this.set_member_running(agent.id, 1, turn_id);
    let running = true;
    try {
      const result = await turn.finished;
      // 成员已经产出最终结果，立刻结束输入态；后续的回复落盘和递归投递不属于输入阶段。
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
      const reply = await this.append_message({
        sender_type: "agent",
        sender_id: agent.id,
        text: result.text.trim(),
        reply_to: message.id,
        ...(turn_id ? { turn_id } : {}),
        ...(dispatch_id ? { dispatch_id } : {}),
        ...(dispatch_stage_id ? { dispatch_stage_id } : {}),
      });
      return reply;
    } catch (error) {
      if (!this.stop_requested && !this.disposed) {
        await this.append_member_failure(agent, message, error);
      }
      return null;
    } finally {
      if (running) this.set_member_running(agent.id, -1, turn_id);
    }
  }

  private async append_dispatch_failure(message: GroupMessage, error: unknown): Promise<void> {
    if (this.stop_requested || this.disposed) return;
    await this.append_message({
      sender_type: "system",
      sender_id: "system",
      text: error instanceof Error ? error.message : String(error),
      reply_to: message.id,
    });
  }

  /** 把成员自身的投递或执行失败记录为共享事实，避免群聊静默。 */
  private async append_member_failure(
    agent: Agent,
    message: GroupMessage,
    error: unknown,
  ): Promise<void> {
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
    let session = this.member_sessions.get(agent.id);
    if (session) return session;
    let create_promise = this.member_session_promises.get(agent.id);
    if (!create_promise) {
      create_promise = this.create_member_session(agent);
      this.member_session_promises.set(agent.id, create_promise);
    }
    try {
      return await create_promise;
    } finally {
      if (this.member_session_promises.get(agent.id) === create_promise) {
        this.member_session_promises.delete(agent.id);
      }
    }
  }

  /** 创建并登记一个成员专属的 AgentSession。 */
  private async create_member_session(agent: Agent): Promise<AgentSession> {
    const session = await agent.sessions.create({
      ...(this.workspace ? { workspace: this.workspace } : {}),
      origin: {
        type: "group",
        group_id: this.group_id,
        group_session_id: this.id,
      },
    });
    this.member_sessions.set(agent.id, session);
    this.member_session_ids.set(agent.id, session.id);
    this.subscribe_member_session(agent.id, session);
    const store = this.store;
    if (!store) throw new Error(`GroupSession "${this.id}" is not initialized`);
    await store.update_metadata({
      member_session_ids: Object.fromEntries(this.member_session_ids),
    });
    return session;
  }

  /** 校验恢复的成员 Session 确实属于当前 GroupSession。 */
  private assert_member_session_origin(session: AgentSession): void {
    if (
      session.origin.type !== "group"
      || session.origin.group_id !== this.group_id
      || session.origin.group_session_id !== this.id
    ) {
      throw new Error(
        `Agent Session "${session.id}" does not belong to GroupSession "${this.id}"`,
      );
    }
  }

  private subscribe_member_session(agent_id: string, session: AgentSession): void {
    this.member_session_unsubscribes.get(agent_id)?.();
    this.member_session_unsubscribes.set(agent_id, session.subscribe((mutation) => {
      if (mutation.variant !== "part" || mutation.type !== "interaction") return;
      if (mutation.part.status === "pending") {
        this.interaction_sessions.set(mutation.part.interaction_id, session);
        this.publish_event({ type: "interaction", agent_id, request: mutation.part.request });
      } else {
        this.interaction_sessions.delete(mutation.part.interaction_id);
      }
    }));
  }

  private build_member_context(
    agent: Agent,
    message: GroupMessage,
    context_messages: readonly GroupMessage[],
    dispatch_instruction: string,
  ): string {
    const history = context_messages
      .filter((item) => item.id !== message.id)
      .map((item) => `${item.sender_type === "user" ? "User" : item.sender_id}: ${item.text}`)
      .join("\n");
    return [
      `Group: ${this.group_name}`,
      this.instruction ? `Group objective: ${this.instruction}` : "",
      `Your identity: ${agent.name} (${agent.id})`,
      `Your description: ${agent.description || "（未提供）"}`,
      "Conversation:",
      history || "（无）",
      "Current message:",
      `${message.sender_type === "agent" ? message.sender_id : "user"}: ${message.text}`,
      "Assignment:",
      dispatch_instruction,
      "Response constraints:",
      `- 只代表成员 ${agent.id} 自己发言。`,
      "- 直接完成 Assignment，不判断或改写其他成员的任务。",
      "- 不代替、指挥、裁定、总结或转述其他成员。",
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
    if ((previous_count > 0) === (next_count > 0)) return;
    this.publish_status(turn_id, this.stop_requested ? "stopped" : "executing");
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
      const title = await generate_session_title({
        model: this.model,
        session_id: this.id,
        first_user_text: first_user_message.text,
        signal,
      });
      if (!title || signal.aborted || !this.store) return;
      const changed = await this.run_metadata_mutation(async () => {
        if (!this.store || signal.aborted) return false;
        const latest_metadata = await this.store.read_metadata();
        const source_exists = this.messages_by_id.some((message) => message.id === first_user_message.id);
        if (normalize_session_title(latest_metadata.title) || !source_exists || signal.aborted) return false;
        await this.store.update_metadata({ title });
        return true;
      });
      if (changed && !signal.aborted) this.publish_event({ type: "title", title });
    });
  }

  /** 串行提交 GroupSession metadata，避免后台标题覆盖手动重命名。 */
  private async run_metadata_mutation<T>(mutation: () => Promise<T>): Promise<T> {
    const task = this.metadata_mutation_chain.then(mutation, mutation);
    this.metadata_mutation_chain = task.then(
      () => undefined,
      () => undefined,
    );
    return await task;
  }

  /** 持久化当前调度检查点；只记录可由消息事实安全恢复的状态。 */
  private async persist_dispatch_checkpoint(): Promise<void> {
    if (!this.store) return;
    await this.store.update_metadata({
      pending_turns: [...this.group_turns_by_id.values()]
        .filter((group_turn) => !group_turn.stopped)
        .map((group_turn) => ({
          turn_id: group_turn.turn_id,
          root_message_id: group_turn.root_message_id,
          context_message_ids: [...group_turn.context_message_ids],
          dispatch_stage: group_turn.dispatch_stage,
        })),
      auto_frontier_message_ids: this.auto_frontier_messages.map((message) => message.id),
    });
  }

  /** 发布 Group 阶段和成员运行态；所有状态与消息共用同一订阅流。 */
  private publish_status(
    turn_id: string | undefined,
    phase: "idle" | "dispatching" | "dispatched" | "executing" | "stopped" | "failed",
    context?: { message_id?: string; dispatched_member_ids?: readonly string[] },
  ): void {
    const event = {
      type: "status" as const,
      ...(turn_id ? { turn_id } : {}),
      ...(context?.message_id ? { message_id: context.message_id } : {}),
      ...(context?.dispatched_member_ids ? { dispatched_member_ids: [...context.dispatched_member_ids] } : {}),
      phase,
      members: this.member_statuses(),
    };
    for (const subscriber of this.subscribers) void subscriber(event);
  }

  private publish_event(event: Parameters<GroupEventSubscriber>[0]): void {
    for (const subscriber of this.subscribers) void subscriber(event);
  }

  private assert_available(): void {
    if (this.disposed) throw new Error(`GroupSession "${this.id}" is disposed`);
    if (this.stop_requested) throw new Error(`GroupSession "${this.id}" is stopping`);
  }
}
