/**
 * Session 模型失败控制屏障。
 *
 * 原执行栈拥有冻结的步骤输入和工具绑定，本对象只接收控制动作并唤醒原步骤。
 * 接收记录先可靠提交再唤醒；所有查询、提交和失效操作共用串行边界。
 * 进程退出后不恢复内存闭包，持久化记录明确转为中断。
 */
import type { SessionModelRetry, SessionModelRetryInput, SessionModelRetryResult } from "@downcity/type";
import type { PendingModelRetry, SessionModelInputSnapshot, PreparedSessionModelInput } from "@/types/session/SessionModelInput.js";
import { snapshot_model_input, validate_model_input, model_input_digest } from "./SessionModelInput.js";
import type { SessionAssistantOutput } from "@/types/turn/SessionAssistantOutput.js";
import type { ModelCall } from "@downcity/type";
import type { SessionMessages } from "../messages/SessionMessages.js";

/** 新用户输入已替代旧步骤，交回正常的检查点处理。 */
export class ModelRetrySuperseded extends Error {}

/** 每个 Session 独占一个控制屏障，不接受正文或重新提交 Prompt。 */
export class SessionModelRetryControl {
  private pending?: PendingModelRetry;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly messages: SessionMessages, private readonly blocked: () => boolean, private readonly has_prompt: () => boolean = () => true) {}

  /** 在原 Writer 所属数据库中保存最终输入依据；返回的校验器每次接收前读取权威事实。 */
  async prepare_input(record: SessionModelRetry, call: ModelCall, output: SessionAssistantOutput,
    redact: (value: unknown) => unknown, validate_config?: () => Promise<void>): Promise<PreparedSessionModelInput> {
    if (!output.save_model_input) throw new Error("Model input persistence unavailable");
    const snapshot = await snapshot_model_input({ ...record, call, history: await this.messages.list_history_messages(), redact });
    const input_part_id = await output.save_model_input(snapshot);
    return { input_part_id, validate: async () => {
      await validate_config?.();
      const history = await this.messages.list_history_messages();
      const saved = history.flatMap(message => message.role === "agent" ? message.parts : []).find(part => part.part_id === input_part_id);
      if (saved?.type !== "data" || model_input_digest(saved.data) !== model_input_digest(snapshot)) throw new Error("Saved model input is unavailable or corrupted");
      await validate_model_input(saved.data as unknown as SessionModelInputSnapshot, call, history);
    } };
  }

  /** 是否正等待用户控制；会话仍持有原 Turn 的执行占用。 */
  is_waiting(): boolean { return this.pending !== undefined; }

  /** 在原步骤暂停，直到手动恢复、新输入替代或用户停止。 */
  async wait(record: SessionModelRetry, save: PendingModelRetry["save"], signal: AbortSignal, validate: () => Promise<void> = async () => {}): Promise<void> {
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
        const message_id = await save(record);
        signal.throwIfAborted();
        checkpoint = { record: structuredClone(record), save, message_id, validate, resume, reject };
        this.pending = checkpoint;
        if (this.blocked()) await this.supersede_pending(this.has_prompt());
      });
      if (!await resumed) throw new ModelRetrySuperseded();
    } catch (error) {
      if (signal.aborted) {
        await this.serialize(async () => {
          if (!checkpoint) return;
          if (this.pending === checkpoint) this.pending = undefined;
          await checkpoint.save({ ...checkpoint.record, status: "stopped", recoverable: false });
        });
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", on_abort);
    }
  }

  /** 在同一串行边界先查幂等记录，再校验当前失败锚点。 */
  async submit(input: SessionModelRetryInput): Promise<SessionModelRetryResult> {
    return await this.serialize(async () => {
      if (!input.request_id?.trim() || !input.message_id?.trim() || !input.failure_attempt_id?.trim()) {
        return { accepted: false, reason: "Retry requires message, failure attempt and request identities" };
      }
      const history = await this.messages.list_history_messages();
      for (const message of history) {
        if (message.role !== "agent") continue;
        for (const part of message.parts) {
          if (part.type !== "error" || !part.retry) continue;
          const receipt = part.retry.receipts.find(item => item.request_id === input.request_id);
          if (!receipt) continue;
          if (message.message_id !== input.message_id || receipt.failure_attempt_id !== input.failure_attempt_id) {
            return { accepted: false, reason: "Retry request identity belongs to another failure" };
          }
          // 底层提交已落盘但写回执丢失时，确认同时接回原等待点，不能留下已接收却未调度的工作。
          const received = this.pending;
          if (part.retry.status === "running" && received?.record.step_id === part.retry.step_id) {
            await received.save(part.retry);
            received.record = part.retry;
            this.pending = undefined;
            received.resume(true);
          }
          return { accepted: true, retry: part.retry };
        }
      }
      if (input.confirm_only) return { accepted: false, reason: "Retry request was not received" };
      const pending = this.pending;
      if (!pending || pending.message_id !== input.message_id || pending.record.status !== "failed"
        || pending.record.attempts.at(-1)?.attempt_id !== input.failure_attempt_id) {
        return { accepted: false, reason: "This failure is no longer the current retry checkpoint" };
      }
      const has_interaction = history.some(message => message.role === "agent" && message.parts.some(part => part.type === "tool"
        && part.interactions?.some(interaction => interaction.status === "pending")));
      if (!pending.record.recoverable || this.blocked() || has_interaction) return { accepted: false, reason: "Resolve pending input or interaction before retrying" };
      const retry_at_ms = pending.record.attempts.at(-1)?.error?.retry_at_ms;
      if (retry_at_ms && Date.now() < retry_at_ms) return { accepted: false, reason: "Provider retry window has not opened" };
      try { await pending.validate(); } catch (error) {
        const reason = error instanceof Error ? error.message : "Original model input could not be verified";
        await pending.save({ ...pending.record, status: "interrupted", recoverable: false, reason });
        this.pending = undefined;
        pending.reject(new Error(reason));
        return { accepted: false, reason };
      }
      if (this.blocked()) return { accepted: false, reason: "Session input changed during retry validation" };
      const record: SessionModelRetry = { ...pending.record, status: "running", receipts: [...pending.record.receipts, {
        request_id: input.request_id, failure_attempt_id: input.failure_attempt_id, accepted_at: Date.now(),
      }] };
      pending.record = record;
      try { await pending.save(record); } catch (error) {
        // 发生 unknown 时保持原 request_id 占用，禁止另一请求覆盖已经可能落盘的接收关系。
        try {
          const current = (await this.messages.list_history_messages()).find(message => message.message_id === pending.message_id);
          const persisted = current?.role === "agent" ? current.parts.find(part => part.type === "error" && part.retry?.step_id === record.step_id) : undefined;
          if (persisted?.type === "error" && persisted.retry) pending.record = persisted.retry;
        } catch { /* 读取同样未知时保持 running，等待原身份确认。 */ }
        throw error;
      }
      this.pending = undefined;
      pending.resume(true);
      return { accepted: true, retry: structuredClone(record) };
    });
  }

  /** 输入入队立即使等待中的旧锚点失效，下一检查点读取真正的新输入。 */
  notify_input(continue_execution = true): void {
    void this.serialize(() => this.supersede_pending(continue_execution)).catch(error => {
      const pending = this.pending;
      this.pending = undefined;
      pending?.reject(error);
    });
  }

  private async supersede_pending(continue_execution: boolean): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    if (pending.record.status === "running" && pending.record.receipts.length > 0) {
      // 原控制写回执未知时先可靠确认接收事实，新输入只能进入后续步骤。
      await pending.save(pending.record);
      this.pending = undefined;
      pending.resume(true);
      return;
    }
    await pending.save({ ...pending.record, status: "superseded", recoverable: false });
    this.pending = undefined;
    if (continue_execution) pending.resume(false);
    else pending.reject(new Error("Session configuration changed; start a new request"));
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation, operation);
    this.chain = result.then(() => undefined, () => undefined);
    return await result;
  }
}
