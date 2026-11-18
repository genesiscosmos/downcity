/** Remote Prompt 调用的接收快照；身份仍是原生 Turn，不创建独立执行实体。 */
import type { AgentSessionTurnResult } from "@downcity/agent";

/** 一次普通 Prompt 方法调用的返回值。 */
export interface RemotePromptTurn {
  /** 本调用所属逻辑 Turn 的稳定标识。 */
  id: string;
  /** 已结算的该调用结果；null 表示尚未结算，不能从其他同 Turn 调用的缓存替代。 */
  result: AgentSessionTurnResult | null;
}
