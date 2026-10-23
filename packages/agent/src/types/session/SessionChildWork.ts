/**
 * Session 子工作生命周期端口。
 * Turn 编排器只等待或取消拥有的子工作，不接触 Agent 委派记录与存储。
 */
import type { SessionOrigin } from "@downcity/type";

/** 父 Turn 收尾时由 Agent 提供的子工作管理能力。 */
export interface SessionChildWork {
  /**
   * 等待本 Turn 的子工作全部完成结果投递；无待处理工作时立即兑现。
   * 不能只等子模型结束，也不能把 abort 当成完成投递。
   * abort 必须立即释放本次观察；它也可能表示 Loop 已被新输入唤醒，
   * 因此不得取消实际子执行、结果投递或其他并发等待。
   */
  wait(input: SessionChildWorkInput): Promise<void>;
  /**
   * 失败或停止时封闭本 Turn 的新委派并停止未完成子树，保留历史。
   * 必须幂等并覆盖正在创建、准备及入队的请求；不得停止父 Session。
   * 即使 input.abort_signal 已中止也必须执行清理，不能提前拒绝或跳过。
   */
  cancel(input: SessionChildWorkInput): Promise<void>;
}

/** 由 Session 运行时生成的父 Turn 身份。 */
export interface SessionChildWorkInput {
  /** 当前父会话的稳定标识。 */
  session_id: string;
  /** 父会话的不可变来源，包含分类与角色。 */
  origin: SessionOrigin;
  /** 当前父 Turn 的稳定标识，避免影响后续执行。 */
  turn_id: string;
  /**
   * wait 的观察取消信号：父停止或输入唤醒时中止，不代表取消实际子工作。
   * cancel 收到父执行信号，仅作上下文；已中止时仍须完成子树清理。
   */
  abort_signal: AbortSignal;
}
