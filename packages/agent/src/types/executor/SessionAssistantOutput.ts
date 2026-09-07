/**
 * Executor 到 canonical Session Assistant Message 的输出端口。
 *
 * 该端口直接消费 Downcity Model Protocol 事件，不定义或转发 UI-shaped chunk。
 */

import type { ModelStreamEvent } from "@downcity/type";
import type { SessionAssistantResultPart } from "@downcity/type";
import type { SessionAssistantMessagePart } from "@downcity/type";
import type {
  SessionToolExecutionResult,
  SessionToolInputReady,
} from "@/types/session/SessionTool.js";

/** Executor 写入当前 Turn Assistant Message 的稳定能力。 */
export interface SessionAssistantOutput {
  /** 开始一个模型 Step 的独立 Part 作用域。 */
  begin_step(): Promise<void>;
  /** 直接写入单个标准模型流事件。 */
  write_model_event(event: ModelStreamEvent): Promise<void>;
  /** 在 Tool 审批或执行前提交完整输入。 */
  prepare_tool_input(input: SessionToolInputReady): Promise<void>;
  /** 写入 Tool 执行终态。 */
  write_tool_result(result: SessionToolExecutionResult): Promise<void>;
  /** 使用模型流聚合出的 canonical Parts 校验当前 Step。 */
  finish_step(parts: SessionAssistantMessagePart[]): Promise<void>;
  /** 放弃当前未完成 Step 的临时作用域。 */
  abort_step(): Promise<void>;
  /** User steer 插入前关闭当前连续 Assistant Message。 */
  close_current_message(): Promise<void>;
  /** 把 Action 产生的封闭内容追加到当前 Assistant Message。 */
  append_result_parts(parts: readonly SessionAssistantResultPart[]): Promise<void>;
  /** 按 Turn 最终结果收口 Assistant 输出。 */
  finish(input: {
    /** Assistant 最终状态。 */
    status: "completed" | "failed" | "stopped";
    /** 失败时写入 Assistant Message 的错误文本。 */
    error?: string;
  }): Promise<void>;
}
