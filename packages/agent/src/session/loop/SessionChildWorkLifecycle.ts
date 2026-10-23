/**
 * Turn 子工作收尾协调：以输入入队、子工作完成和 abort 唤醒等待。
 * 不消费队列、不启动模型，也不新增执行循环；所有监听在单次等待退出时释放。
 */
import type { SessionChildWork, SessionChildWorkInput } from "@/types/session/SessionChildWork.js";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** SessionLoop 拥有的子工作生命周期与同步输入通知。 */
export class SessionChildWorkLifecycle {
  private readonly input_listeners = new Set<() => void>();
  /** 同一 Turn 的失败路径可能重入，子树取消只发起一次。 */
  private readonly cancellations = new WeakMap<SessionTurnContext, Promise<void>>();

  constructor(
    private readonly child_work: SessionChildWork | undefined,
    private readonly logger: Logger,
  ) {}

  /** Prompt 已同步入队；无需等待 canonical 接收回执即可唤醒消费者。 */
  notify_prompt(): void {
    for (const listener of this.input_listeners) listener();
  }

  /**
   * 一级 Work 收尾等待；返回是否需要消费输入并继续原 Turn。
   * wait 的完成必须表示本 Turn 已无待投递子工作，不能仅表示子模型结束。
   */
  async wait(context: SessionTurnContext, has_pending: () => boolean): Promise<boolean> {
    const origin = context.session.origin;
    const signal = context.lifecycle.abort_signal;
    if (!this.child_work || origin.category !== "work" || origin.type !== "work"
      || origin.delegation_depth !== 1 || signal.aborted) return false;

    // 先装监听再检查输入，覆盖子结果在 wait 调用前同步入队的窗口。
    let wake_input!: () => void;
    let wake_abort!: () => void;
    const input_ready = new Promise<void>((resolve) => { wake_input = resolve; });
    const aborted = new Promise<void>((resolve) => { wake_abort = resolve; });
    const controller = new AbortController();
    const on_abort = () => {
      wake_abort();
      controller.abort(signal.reason);
    };
    this.input_listeners.add(wake_input);
    signal.addEventListener("abort", on_abort, { once: true });
    try {
      if (signal.aborted) return false;
      if (has_pending()) return true;
      const completion = this.child_work.wait(this.input(context, controller.signal));
      await Promise.race([completion, input_ready, aborted]);
      return !signal.aborted && has_pending();
    } catch (error) {
      if (signal.aborted) return false;
      throw error;
    } finally {
      this.input_listeners.delete(wake_input);
      signal.removeEventListener("abort", on_abort);
      // 输入唤醒后释放本次观察；不取消实际子执行或结果投递。
      controller.abort();
    }
  }

  /**
   * 失败、停止和异常收口共用幂等取消；已中止的父 signal 不得阻止子树清理。
   * 清理故障独立记录，不能让父 Turn 的完成句柄永久悬挂。
   */
  async cancel(context: SessionTurnContext): Promise<void> {
    if (!this.child_work) return;
    let operation = this.cancellations.get(context);
    if (!operation) {
      operation = Promise.resolve().then(async () => {
        try {
          await this.child_work!.cancel(this.input(context, context.lifecycle.abort_signal));
        } catch (error) {
          try {
            await this.logger.log("warn", "[agent] child work cancellation failed", {
              session_id: context.session.session_id,
              turn_id: context.session.turn_id,
              error: error instanceof Error ? error.message : String(error),
            });
          } catch {
            // 清理和日志都不能阻断父 Turn 的失败收口。
          }
        }
      });
      this.cancellations.set(context, operation);
    }
    await operation;
  }

  /** 每次按当前上下文生成身份，fork 不会复用源 Session 的取消范围。 */
  private input(context: SessionTurnContext, abort_signal: AbortSignal): SessionChildWorkInput {
    return {
      session_id: context.session.session_id,
      origin: context.session.origin,
      turn_id: context.session.turn_id,
      abort_signal,
    };
  }
}
