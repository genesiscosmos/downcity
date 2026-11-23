/**
 * Session 子工作生命周期端口。
 * Turn 编排器只在失败或停止时取消拥有的子工作，不接触 Agent 委派记录与存储。
 */
import type { SessionDescriptor } from "@downcity/type";

/** 父 Turn 收尾时由 Agent 提供的子工作管理能力。 */
export interface SessionChildWork {
  /** 显式停止整个父会话的未完成子工作，覆盖已结束 Turn；返回是否找到子工作。 */
  stop(input: SessionChildWorkTarget): Promise<boolean>;
  /**
   * 失败或停止时取消本执行代次的新委派并停止未完成子树，保留历史。
   * 必须幂等并覆盖正在创建、准备及入队的请求；不得停止父 Session。
   * 即使 input.abort_signal 已中止也必须执行清理，不能提前拒绝或跳过。
   */
  cancel(input: SessionChildWorkInput): Promise<void>;
}

/** 显式停止时的父会话身份；不受当前 Turn 是否活动影响。 */
export interface SessionChildWorkTarget extends SessionDescriptor {
  /** 拥有子工作的父 Session 稳定标识。 */
  session_id: string;
}

/** 由 Session 运行时生成的父 Turn 身份。 */
export interface SessionChildWorkInput extends SessionDescriptor {
  /** 当前父会话的稳定标识。 */
  session_id: string;

  /** 当前父 Turn 的稳定标识，避免影响后续执行。 */
  turn_id: string;
  /** 当前父执行代次；同 Turn 重试不会继承原代次取消状态。 */
  execution_id: string;
  /** 父执行停止或失败时传入的取消信号；即使已中止也必须完成子树清理。 */
  abort_signal: AbortSignal;
}
