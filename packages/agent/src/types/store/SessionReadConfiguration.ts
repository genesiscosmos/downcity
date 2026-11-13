/** 只读Session配置快照，允许归档浏览但不授予执行、模型切换或审批能力。 */
import type { SessionModelBinding } from "./SessionModelBinding.js";
import type { SessionExecutionProfileReference } from "../agent/SessionExecutionProfile.js";

/** 配置与消息页独立读取，避免system snapshot阻塞历史展示。 */
export interface SessionReadConfiguration {
  /** 持久化模型事实，缺失时不从label猜测ID。 */
  model_binding?: SessionModelBinding;
  /** configured审批模式，不代表当前执行器的effective模式。 */
  approval_mode?: "ask" | "always-allow";
  /** 不可变执行配置引用，仅作为持久化事实展示。 */
  execution_profile?: SessionExecutionProfileReference;
  /** 显式基础system快照，未设置为null。 */
  system_snapshot: string | null;
}
