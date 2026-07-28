/**
 * Session Turn 执行结果与输入类型。
 *
 * 关键点（中文）
 * - `SessionTurnExecutionInput` 表示上层 Turn 执行入口输入。
 * - `SessionStepExecutionInput` 表示 Executor 通过 Composer 装配后的 Step 输入。
 * - 输出只返回执行结果；Assistant Message 通过显式输出端口写入唯一事实源。
 */

import type { FileUIPart, Tool, UIMessageChunk } from "ai";
import type {
  SessionRecordV1,
  SessionMessageRecordV1,
  SessionUserMessageV1,
} from "@/executor/types/SessionRecords.js";
import type { SessionSystemMessage } from "@/executor/types/SessionPrompts.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";

/**
 * Assistant step 可见性。
 *
 * 说明（中文）
 * - `visible`：ACP `agent_message_chunk` 或普通模型文本，属于用户可见回复。
 * - `internal`：ACP `agent_thought_chunk` 等内部过程，应作为 reasoning 保留，但不能混入普通 text。
 */
export type SessionAssistantStepVisibility = "visible" | "internal";

/**
 * Assistant step 回调入参。
 */
export interface SessionAssistantStepCallbackInput {
  /**
   * 当前 step 生成的文本。
   */
  text: string;

  /**
   * 当前 step 序号（从 1 开始）。
   */
  step_index: number;

  /**
   * 当前 step 的可见性。
   *
   * 关键点（中文）
   * - 未声明时按 `visible` 处理，兼容本地模型与旧调用方。
   * - `internal` 会落盘为 reasoning part，外部渠道不应当成普通回复文本发送。
   */
  visibility?: SessionAssistantStepVisibility;

  /**
   * 当前 step 的原始结果对象。
   *
   * 关键点（中文）
   * - 由运行时直接透传，供持久化层提取 tool call / tool result 顺序事件。
   * - 外部调用方不应依赖其稳定结构，只能做 best-effort 读取。
   */
  step_result?: unknown;
}

/**
 * Assistant step 完成回调。
 */
export type SessionAssistantStepCallback = (
  input: SessionAssistantStepCallbackInput,
) => Promise<void>;

/**
 * UI stream chunk 回调入参。
 *
 * 关键点（中文）
 * - 这里直接复用 AI SDK 的 `UIMessageChunk` 结构，避免在 session 内核层再复制一套协议。
 * - SDK / HTTP 若需要自己的事件模型，应在更上层做映射。
 */
export type SessionUiMessageChunk = UIMessageChunk;

/**
 * UI stream chunk 回调。
 */
export type SessionUiMessageChunkCallback = (
  chunk: SessionUiMessageChunk,
) => Promise<void>;

/** 单个模型 UI stream 开始前的 canonical step 回调。 */
export type SessionUiMessageStepStartCallback = () => Promise<void>;

/** 单个模型 UI stream 完成后的 canonical step 快照回调。 */
export type SessionUiMessageStepFinishCallback = (
  message: SessionMessageRecordV1,
) => Promise<void>;

/** 单个模型 UI stream 未完成时的 canonical step 清理回调。 */
export type SessionUiMessageStepAbortCallback = () => Promise<void>;

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
   * 工具运行期显式生成、并在 Assistant 末尾持久化的文件 Parts。
   *
   * 关键点（中文）：该字段与 canonical Message 输出端口分离，Session 不需要从
   * 最终 UIMessage 反推哪些文件来自工具通道。
   */
  assistant_file_parts?: FileUIPart[];

  /**
   * 本轮执行结束后待写入长期历史的 user 消息。
   *
   * 关键点（中文）
   * - 这些消息通常由 tool 运行时在执行过程中动态注入。
   * - 为保证消息顺序稳定，统一在 assistant 结果落盘后再由外层 Session 持久化。
   */
  deferred_persisted_user_messages?: SessionUserMessageV1[];

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
   * - 这里承载 Step 合并、UI chunk 回调等跨组件运行期数据。
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

  /**
   * 当前轮 context 语义消息历史。
   */
  messages: SessionRecordV1[];

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
