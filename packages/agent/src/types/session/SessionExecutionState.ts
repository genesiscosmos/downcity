/** SessionLoop 运行投影依赖；只读原所有者事实，不复制 Turn 或恢复生命周期。 */
import type { SessionRuntimeSnapshot } from "@downcity/type";
import type { SessionTurnContext } from "@/types/turn/SessionTurnContext.js";
import type { SessionTurnCompletionOptions } from "./SessionTurnCompletion.js";

/** 统一阶段发布所需的窄端口。 */
export interface SessionExecutionStateOptions {
  /** 读取原 Loop 的生命周期与有效恢复绑定。 */
  read: () => Omit<SessionRuntimeSnapshot, "state"> & {
    /** 消费器正在自主执行或收尾。 */
    processing: boolean;
    /** canonical 交互中存在等待用户的请求。 */
    interaction: boolean;
  };
  /** 发布与 status 同源的运行快照。 */
  publish: (snapshot: SessionRuntimeSnapshot) => void;
  /** 当前 Turn 上下文，只有它能授权临时执行通知。 */
  context: () => SessionTurnContext | undefined;
  /** 当前 Hook 及调用上下文解析器。 */
  effects: Pick<SessionTurnCompletionOptions, "session_id" | "get_hooks" | "create_call_context">;
}
