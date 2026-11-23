/**
 * Turn 子工作收尾协调：父 Turn 结束时保留独立运行的 Child，失败或停止时负责取消子树。
 * 不消费队列、不启动模型；Child 结果通过后台输入回到父 Session 的后续 Turn。
 */
import { normalize_session_descriptor } from "@downcity/type";
import type { SessionChildWork, SessionChildWorkInput, SessionChildWorkTarget } from "@/types/session/SessionChildWork.js";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** SessionLoop 拥有的子工作停止与失败收尾。 */
export class SessionChildWorkLifecycle {
  /** 同一 Turn 的失败路径可能重入，子树取消只发起一次。 */
  private readonly cancellations = new WeakMap<SessionTurnContext, Promise<void>>();

  constructor(
    private readonly child_work: SessionChildWork | undefined,
    private readonly logger: Logger,
  ) {}

  /** 显式停止覆盖当前 Session 的全部子工作；Chat 的自主 Main 不随 Chat 停止。 */
  async stop(target: SessionChildWorkTarget): Promise<boolean> {
    if (!this.child_work || target.type !== "work") return false;
    return await this.child_work.stop(target);
  }

  /**
   * 失败、停止和异常收口共用幂等取消；已中止的父 signal 不得阻止子树清理。
   * 清理故障独立记录，不能让父 Turn 的完成句柄永久悬挂。
   */
  async cancel(context: SessionTurnContext): Promise<void> {
    // Chat 的本轮交流结束不撤销自主 Main；只有 Work 执行负责所属 Child。
    if (!this.child_work || context.session.type !== "work") return;
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
      ...normalize_session_descriptor(context.session),
      turn_id: context.session.turn_id,
      execution_id: context.session.execution_id,
      abort_signal,
    };
  }
}
