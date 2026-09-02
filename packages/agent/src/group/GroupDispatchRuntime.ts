/**
 * GroupSession 私有调度运行器。
 *
 * 本模块只封装调度请求的串行执行、模型取消和 Turn 状态提交。共享消息、成员关系、
 * 恢复检查点与整体生命周期仍由 GroupSession 统一拥有。
 */

import { nanoid } from "nanoid";
import type {
  GroupDispatchInput,
  GroupDispatchResult,
  GroupDispatchRuntimeOptions,
  GroupDispatchTurnRecord,
} from "@/types/group/GroupDispatch.js";
import type { GroupSessionDataStore } from "@/types/group/GroupSessionStore.js";

/** 主动停止 Group 调度时使用的内部错误。 */
export class GroupDispatchStoppedError extends Error {
  constructor() {
    super("Group dispatch stopped");
    this.name = "GroupDispatchStoppedError";
  }
}

/** GroupSession 私有的调度运行机制，不构成独立 Session。 */
export class GroupDispatchRuntime {
  private readonly dispatch_strategy: GroupDispatchRuntimeOptions["dispatch_strategy"];
  private store?: GroupSessionDataStore;
  private queue_tail: Promise<void> = Promise.resolve();
  private active_abort_controller?: AbortController;
  private stopping = false;
  private disposed = false;

  constructor(options: GroupDispatchRuntimeOptions) {
    this.dispatch_strategy = options.dispatch_strategy;
  }

  /** 绑定 GroupSession Store，并把进程中断留下的运行态明确收口为 stopped。 */
  async initialize(store: GroupSessionDataStore): Promise<this> {
    if (this.store && this.store !== store) {
      throw new Error("GroupDispatchRuntime is already initialized with another Store");
    }
    if (this.store === store) return this;
    this.store = store;
    const interrupted_turns = (await store.list_dispatch_turns()).filter((turn) => (
      turn.status === "queued" || turn.status === "running"
    ));
    for (const turn of interrupted_turns) {
      await store.append_dispatch_turn({
        ...turn,
        status: "stopped",
        error: "Group dispatch interrupted before recovery",
        updated_at: Date.now(),
      });
    }
    return this;
  }

  /** 按提交顺序执行一次调度，并在返回前持久化最终决定。 */
  decide(input: GroupDispatchInput): Promise<GroupDispatchResult> {
    this.assert_available();
    const store = this.require_store();
    const created_at = Date.now();
    const queued_turn: GroupDispatchTurnRecord = {
      dispatch_id: `group-dispatch-${nanoid(12)}`,
      trigger: input.trigger,
      message_id: input.message.id,
      pending_message_ids: input.pending_messages.map((message) => message.id),
      status: "queued",
      created_at,
      updated_at: created_at,
    };
    const persist_queued = store.append_dispatch_turn(queued_turn);
    const operation = this.queue_tail.then(async () => {
      await persist_queued;
      return await this.execute_turn(input, queued_turn);
    });
    this.queue_tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  /** 中断当前模型调用，并让尚未开始的调度 Turn 按队列顺序收口。 */
  async stop(): Promise<void> {
    if (this.disposed || this.stopping) return;
    this.stopping = true;
    this.active_abort_controller?.abort(new GroupDispatchStoppedError());
    await this.queue_tail;
    this.active_abort_controller = undefined;
    this.stopping = false;
  }

  /** 永久释放当前调度运行器。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.stop();
    this.disposed = true;
    this.store = undefined;
  }

  /** 执行队首调度 Turn，确保成功、失败和停止都形成持久化终态。 */
  private async execute_turn(
    input: GroupDispatchInput,
    queued_turn: GroupDispatchTurnRecord,
  ): Promise<GroupDispatchResult> {
    const store = this.require_store();
    if (this.stopping || this.disposed) {
      await this.persist_terminal_turn(queued_turn, "stopped", "Group dispatch stopped");
      throw new GroupDispatchStoppedError();
    }
    const abort_controller = new AbortController();
    this.active_abort_controller = abort_controller;
    await store.append_dispatch_turn({
      ...queued_turn,
      status: "running",
      updated_at: Date.now(),
    });
    try {
      const decision = await this.dispatch_strategy.decide_dispatch({
        ...input,
        abort_signal: abort_controller.signal,
      });
      if (this.stopping || this.disposed || abort_controller.signal.aborted) {
        throw new GroupDispatchStoppedError();
      }
      await store.append_dispatch_turn({
        ...queued_turn,
        status: "completed",
        decision,
        updated_at: Date.now(),
      });
      return { dispatch_id: queued_turn.dispatch_id, decision };
    } catch (error) {
      if (
        error instanceof GroupDispatchStoppedError ||
        this.stopping ||
        this.disposed ||
        abort_controller.signal.aborted
      ) {
        await this.persist_terminal_turn(queued_turn, "stopped", "Group dispatch stopped");
        throw new GroupDispatchStoppedError();
      }
      const detail = error instanceof Error ? error.message : String(error);
      await this.persist_terminal_turn(queued_turn, "failed", detail);
      throw error;
    } finally {
      if (this.active_abort_controller === abort_controller) {
        this.active_abort_controller = undefined;
      }
    }
  }

  /** 提交没有 decision 的失败或停止终态。 */
  private async persist_terminal_turn(
    turn: GroupDispatchTurnRecord,
    status: "failed" | "stopped",
    error: string,
  ): Promise<void> {
    await this.require_store().append_dispatch_turn({
      ...turn,
      status,
      error,
      updated_at: Date.now(),
    });
  }

  private require_store(): GroupSessionDataStore {
    if (!this.store) throw new Error("GroupDispatchRuntime is not initialized");
    return this.store;
  }

  private assert_available(): void {
    if (this.disposed) throw new Error("GroupDispatchRuntime is disposed");
    if (this.stopping) throw new Error("GroupDispatchRuntime is stopping");
  }
}
