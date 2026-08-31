/**
 * Session Turn 执行结果与输入类型。
 *
 * 关键点（中文）
 * - `SessionTurnExecutionInput` 表示上层 Turn 执行入口输入。
 * - `SessionStepExecutionInput` 表示 Executor 通过 Composer 装配后的 Step 输入。
 * - 输出只返回执行结果；Assistant Message 通过显式输出端口写入唯一事实源。
 */

import type { ModelMessage, RuntimeTool as Tool } from "@downcity/type";
import type { SessionUserMessage } from "@/types/session/SessionMessage.js";
import type { SessionSystemMessage } from "@/executor/types/SessionPrompts.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";

/**
 * Session 执行结果。
 */
export interface SessionTurnExecutionResult {
  /**
   * 本轮执行是否成功。
   */
  success: boolean;

  /** 本轮最终用户可见文本，不承载 Assistant Message 快照。 */
  text: string;

  /**
   * 失败时的错误信息（成功时为空）。
   */
  error?: string;

  /**
   * 本轮执行结束后待写入长期历史的 user 消息。
   *
   * 关键点（中文）
   * - 这些消息通常由 tool 运行时在执行过程中动态注入。
   * - 为保证消息顺序稳定，统一在 assistant 结果落盘后再由外层 Session 持久化。
   */
  deferred_persisted_user_messages?: SessionUserMessage[];

  /**
   * 本轮结束后是否需要把已完成的 canonical 历史持久化压缩。
   *
   * 关键点（中文）
   * - 真实 usage 达到 95% 或本轮已经执行过内存 compact 时为 true。
   * - 上层必须等 Assistant writer 收口后再执行，避免压缩流式草稿。
   */
  compact_required?: boolean;
}

/**
 * Session Turn 执行入口输入。
 */
export interface SessionTurnExecutionInput {
  /**
   * 本轮用户输入查询文本。
   */
  query: string;

  /**
   * 本轮唯一的显式 Turn 上下文。
   *
   * 关键点（中文）
   * - 这里承载标准模型事件输出、Step 合并与取消信号等跨组件运行期数据。
   * - Context 由 Turn 生命周期所有者创建并在 Turn 收口后释放。
   */
  turn_context: SessionTurnContext;
}

/**
 * Executor 通过 Composer 装配后的中间运行态。
 */
export interface SessionStepExecutionInput {
  /**
   * 当前轮用户查询文本。
   */
  query: string;

  /**
   * 当前轮 system messages。
   */
  system: SessionSystemMessage[];

  /** 当前轮标准模型消息历史。 */
  messages: ModelMessage[];

  /** 当前模型历史所包含的最新持久化 Summary 标识。 */
  history_summary_id?: string;

  /**
   * 当前轮可用工具集合。
   */
  tools: Record<string, Tool>;
}

/** 单个 Session 的统一 Turn 执行协议。 */
export interface SessionExecutor {
  /** 执行一个已经由 SessionLoop 创建上下文的 Turn。 */
  execute(
    input: SessionTurnExecutionInput,
  ): Promise<SessionTurnExecutionResult>;
}

/** Session 领域执行一次持久化历史压缩的统一回调。 */
export type SessionCompactHistory = (input: {
  /** 触发压缩的 Turn 标识；非 Turn 维护操作允许为空。 */
  turn_id?: string;
}) => Promise<{
  /** 是否生成并成功提交了压缩计划。 */
  compacted: boolean;
  /** 没有压缩时的稳定原因。 */
  reason?: string;
  /** 压缩失败时的具体错误文本。 */
  error?: string;
}>;
