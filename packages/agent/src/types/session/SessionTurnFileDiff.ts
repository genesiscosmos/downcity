/**
 * Session Turn 文件修改观测函数的依赖类型。
 *
 * 文件 Diff 是辅助观测结果，不参与模型或 Tool 的成功判定；这些类型显式限制它只能
 * 读取 Turn effects、写入 Assistant 输出并发布摘要 Mutation。
 */

import type { RuntimeToolEffect } from "@downcity/type";
import type { SessionAssistantOutput } from "@/types/executor/SessionAssistantOutput.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";
import type { SessionMutation } from "@downcity/type";
import type { Logger } from "@/utils/logger/Logger.js";

/** 持久化 Turn 最终文件 Diff 的输入。 */
export interface AppendSessionTurnFileDiffInput {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Turn 的稳定标识。 */
  turn_id: string;
  /** 当前 Workspace 的绝对根路径。 */
  workspace_path: string;
  /** 当前 Turn 持有的 effects 与生命周期上下文。 */
  turn_context: SessionTurnContext;
  /** 当前 Turn 的 canonical Assistant 输出端口。 */
  assistant_output: SessionAssistantOutput;
  /** 当前 Session 的统一日志器。 */
  logger: Logger;
}

/** 发布 Turn 实时文件 Diff 摘要的输入。 */
export interface PublishSessionTurnFileDiffInput {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Turn 的稳定标识。 */
  turn_id: string;
  /** 当前 Workspace 的绝对根路径。 */
  workspace_path: string;
  /** 当前检查点已经发生的 Tool effects。 */
  effects: readonly RuntimeToolEffect[];
  /** 发布公开 Session Mutation 的函数。 */
  publish: (mutation: SessionMutation) => void;
  /** 当前 Session 的统一日志器。 */
  logger: Logger;
}
