/** Session 引擎池内部所有权与有界调度协议。 */
import type { WorkerEngine } from "../engine/WorkerEngine.js";

/** 一份只属于可信 Session 的非持久状态。 */
export interface RuntimeEntry {
  /** 当前代次唯一引擎。 */
  readonly engine: WorkerEngine;
  /** 每次回收后递增的代次。 */
  readonly generation: number;
  /** 此引擎上次结束或创建的时间。 */
  touched_at: number;
}

/** FIFO 等待中的执行；按 key 保证同 Session 串行。 */
export interface RuntimeJob {
  /** 组合 City/Agent/Session 来源身份。 */
  readonly key: string;
  /** 实际运行并在 finally 中归还调度槽。 */
  readonly run: () => Promise<void>;
  /** 关闭时拒绝队列任务。 */
  readonly reject: (error: Error) => void;
}
