/**
 * Session 模型失败控制屏障。
 *
 * 原执行栈拥有冻结的步骤输入和工具绑定，本对象只接收控制动作并唤醒原步骤。
 * 接受前清除当前错误，所有提交与失效操作共用串行边界。
 * 只持有当前进程的等待点，不保存输入、尝试历史或接收回执。
 */
import type { SessionModelRetry, SessionModelRetryInput, SessionModelRetryResult } from "@downcity/type";
import type { PendingModelRetry } from "@/types/session/SessionModelInput.js";
import type { ModelCall } from "@downcity/type";
import { snapshot_model_input, validate_model_input } from "./SessionModelInput.js";

import type { SessionMessages } from "../messages/SessionMessages.js";

/** 新用户输入已替代旧步骤，交回正常的检查点处理。 */
export class ModelRetrySuperseded extends Error {}

/** 每个 Session 独占一个控制屏障，不接受正文或重新提交 Prompt。 */
export class SessionModelRetryControl {
  private pending?: PendingModelRetry;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly messages: SessionMessages, private readonly blocked: () => boolean, private readonly has_prompt: () => boolean = () => true, private readonly changed: () => void = () => {}) {}

  /** 仅投影当前进程仍持有的恢复绑定，刷新不会从历史错误重建。 */
  current(): SessionModelRetry | undefined {
    const pending = this.pending;
    return pending && !this.blocked() ? { ...pending.binding } : undefined;
  }

  /** 输入版本只由当前步骤闭包持有，进程退出即释放。 */
  async prepare_input(call: ModelCall, validate_config?: () => Promise<void>): Promise<() => Promise<void>> {
    const snapshot = await snapshot_model_input({ call, history: await this.messages.list_history_messages() });
    return async () => {
      await validate_config?.();
      await validate_model_input(snapshot, call, await this.messages.list_history_messages());
    };
  }

  /** 是否正等待用户控制；会话仍持有原 Turn 的执行占用。 */
  is_waiting(): boolean { return this.pending !== undefined; }

  /** 在原步骤暂停，直到手动恢复、新输入替代或用户停止。 */
  async wait(publish: () => Promise<SessionModelRetry>, clear: () => Promise<void>, signal: AbortSignal, validate: () => Promise<void> = async () => {}): Promise<void> {
    signal.throwIfAborted();
    let checkpoint: PendingModelRetry | undefined;
    let resume!: PendingModelRetry["resume"];
    let reject!: PendingModelRetry["reject"];
    const resumed = new Promise<boolean>((resolve, fail) => { resume = resolve; reject = fail; });
    // 初始化落盘期间发生停止也必须关闭等待，避免留下无人持有的恢复 Promise。
    const on_abort = () => { reject(signal.reason); };
    signal.addEventListener("abort", on_abort, { once: true });
    // 先安装拒绝处理器，避免停止早于落盘完成时产生 unhandled rejection。
    void resumed.catch(() => undefined);
    try {
      await this.serialize(async () => {
        signal.throwIfAborted();
        const binding = await publish();
        signal.throwIfAborted();
        checkpoint = { binding, clear, validate, resume, reject, signal };
        this.pending = checkpoint;
        this.changed();
        if (this.blocked()) await this.supersede_pending(this.has_prompt());
      });
      if (!await resumed) throw new ModelRetrySuperseded();
    } catch (error) {
      if (signal.aborted) {
        await this.serialize(async () => {
          if (!checkpoint) return;
          if (this.pending === checkpoint) { this.pending = undefined; this.changed(); }
        });
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", on_abort);
    }
  }

  /** 当前等待点和串行互斥共同防重；不创建另一条执行请求。 */
  async submit(input: SessionModelRetryInput): Promise<SessionModelRetryResult> {
    return await this.serialize(async () => {
      const pending = this.pending;
      if (!pending || pending.binding.message_id !== input.message_id || pending.binding.error_part_id !== input.error_part_id) {
        return { accepted: false, reason: "This failure is no longer the current retry checkpoint" };
      }
      if (this.blocked() || pending.signal.aborted) return { accepted: false, reason: "Session input changed or execution stopped" };
      const history = await this.messages.list_history_messages();
      if (history.some(message => message.role === "agent" && message.parts.some(part => part.type === "tool"
        && part.interactions?.some(interaction => interaction.status === "pending")))) {
        return { accepted: false, reason: "Resolve the pending interaction before retrying" };
      }
      try { await pending.validate(); } catch (error) {
        return { accepted: false, reason: error instanceof Error ? error.message : "Original input unavailable" };
      }
      if (this.blocked() || pending.signal.aborted) return { accepted: false, reason: "Session input changed or execution stopped" };
      // 清除失败时由普通存储边界回读权威消息处理提交未知；不写接收记录。
      await pending.clear();
      if (pending.signal.aborted || this.blocked()) {
        this.pending = undefined;
        this.changed();
        if (pending.signal.aborted) pending.reject(pending.signal.reason);
        else if (this.has_prompt()) pending.resume(false);
        else pending.reject(new Error("Session configuration changed; start a new request"));
        return { accepted: false, reason: "Session input changed or execution stopped" };
      }
      this.pending = undefined;
      this.changed();
      pending.resume(true);
      return { accepted: true };
    });
  }

  /** 输入入队立即使等待中的旧锚点失效，下一检查点读取真正的新输入。 */
  notify_input(continue_execution = true): void {
    void this.serialize(() => this.supersede_pending(continue_execution)).catch(error => {
      const pending = this.pending;
      this.pending = undefined;
      this.changed();
      pending?.reject(error);
    });
  }

  private async supersede_pending(continue_execution: boolean): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    if (continue_execution) await pending.clear();
    this.pending = undefined;
    this.changed();
    if (continue_execution) pending.resume(false);
    else pending.reject(new Error("Session configuration changed; start a new request"));
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation, operation);
    this.chain = result.then(() => undefined, () => undefined);
    return await result;
  }
}
