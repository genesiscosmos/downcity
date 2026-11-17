/**
 * SessionLoop 的统一执行阶段投影。
 *
 * 快照、Mutation 与临时副作用同源；活栈保护与当前活动分别读取。
 * 通知只供实时副作用使用，不进入完成日志，也不重放。失败隔离不改变执行结果。
 */
import { SESSION_HOOK_POINTS, type SessionExecutionStateHookValue, type JsonValue } from "@downcity/type";
import type { SessionRuntimeSnapshot } from "@downcity/type";
import type { SessionExecutionStateOptions } from "@/types/session/SessionExecutionState.js";
import { run_effect_point } from "@/session/input/SessionHookRunner.js";

/** 不拥有 Turn；仅记录 Loop 已进入的子工作等待边界，并统一派生所有外部活动。 */
export class SessionExecutionState {
  private waiting_child = false;
  private last_snapshot = "";
  private last_effect = "";
  private effect_context?: ReturnType<SessionExecutionStateOptions["context"]>;
  private effect_chain: Promise<void> = Promise.resolve();

  constructor(private readonly options: SessionExecutionStateOptions) {}

  /** 只读取当前所有者事实；保留恢复点不等于当前仍在执行。 */
  snapshot(): SessionRuntimeSnapshot {
    const { processing, interaction, ...runtime } = this.options.read();
    return { ...runtime, state: runtime.model_retry ? "failed" : interaction && runtime.live_execution ? "waiting_input"
      : this.waiting_child ? "waiting_child" : processing ? "running" : "idle" };
  }

  /** 子工作等待只是原 Loop 的执行边界；不会完成父 Turn 或交付结果。 */
  set_waiting_child(active: boolean): void {
    this.waiting_child = active;
    this.publish();
  }

  /** status、runtime 与 typing 使用同一快照；临时 Hook 串行且不承担完成责任。 */
  publish(): void {
    const snapshot = this.snapshot();
    const key = JSON.stringify(snapshot);
    if (key !== this.last_snapshot) {
      this.last_snapshot = key;
      this.options.publish(snapshot);
    }
    const current_context = this.options.context();
    const context = current_context ?? this.effect_context;
    this.effect_context = current_context;
    const state = snapshot.state === "running" && current_context ? "running" : "idle";
    const effect_key = `${context?.session.turn_id ?? ""}:${state}`;
    if (!context || effect_key === this.last_effect) return;
    this.last_effect = effect_key;
    const options = this.options.effects;
    const hooks = options.get_hooks();
    const value: SessionExecutionStateHookValue = { session_id: options.session_id, turn_id: context.session.turn_id, state };
    this.effect_chain = this.effect_chain.then(async () => {
      try {
        await run_effect_point({ hooks, point_name: SESSION_HOOK_POINTS.execution_state,
          value: value as unknown as JsonValue,
          context: options.create_call_context({ turn_id: context.session.turn_id, abort_signal: context.lifecycle.abort_signal }) });
      } catch { /* 临时副作用不能改变原执行结果。 */ }
    });
  }
}
