/**
 * Downcity 模型事件到 canonical Assistant Message 的输出 Adapter。
 *
 * Adapter 只负责惰性打开当前 Turn 的唯一 Writer，并把标准模型事件、Tool 结果与
 * Action 内容转交给 Writer；`SessionMessages` 始终是唯一事实源。
 */

import type { ModelStreamEvent } from "@downcity/type";
import {
  SessionAssistantMessageWriter,
  SessionMessages,
} from "@/session/SessionMessages.js";
import type { SessionAssistantResultPart } from "@/types/session/SessionContent.js";
import type { SessionAssistantMessagePart } from "@/types/session/SessionMessage.js";
import type { SessionAssistantOutput } from "@/types/executor/SessionAssistantOutput.js";
import type {
  SessionToolExecutionResult,
  SessionToolInputReady,
} from "@/types/session/SessionTool.js";

/** 单个 Turn 使用的 Assistant 输出 Adapter。 */
export class SessionAssistantOutputAdapter implements SessionAssistantOutput {
  private readonly turn_id: string;
  private readonly messages: SessionMessages;
  private writer: SessionAssistantMessageWriter | null = null;
  private writer_task: Promise<SessionAssistantMessageWriter> | null = null;
  private step_pending = false;

  constructor(options: {
    /** 当前输出所属 Turn 标识。 */
    turn_id: string;
    /** canonical Message 写入入口。 */
    messages: SessionMessages;
  }) {
    this.turn_id = String(options.turn_id || "").trim();
    this.messages = options.messages;
    if (!this.turn_id) {
      throw new Error("SessionAssistantOutputAdapter requires a non-empty turn_id");
    }
  }

  /** 开始当前模型 Step。 */
  async begin_step(): Promise<void> {
    if (this.writer) {
      await this.writer.begin_step();
      return;
    }
    this.step_pending = true;
  }

  /** 直接写入单个标准模型事件。 */
  async write_model_event(event: ModelStreamEvent): Promise<void> {
    if (!is_assistant_content_event(event)) return;
    await (await this.ensure_writer()).apply_model_event(event);
  }

  /** 在 Tool 执行前提交完整输入。 */
  async prepare_tool_input(input: SessionToolInputReady): Promise<void> {
    await (await this.ensure_writer()).prepare_tool_input(input);
  }

  /** 写入 Tool 执行终态。 */
  async write_tool_result(result: SessionToolExecutionResult): Promise<void> {
    await (await this.ensure_writer()).apply_tool_result(result);
  }

  /** 使用模型聚合出的 canonical Parts 校验当前 Step。 */
  async finish_step(parts: SessionAssistantMessagePart[]): Promise<void> {
    await (await this.ensure_writer()).finish_step(parts);
  }

  /** 清理异常结束的 Step 作用域。 */
  async abort_step(): Promise<void> {
    if (this.writer) await this.writer.abort_step();
    this.step_pending = false;
  }

  /** User steer 持久化后关闭它之前的当前 Assistant Message。 */
  async close_current_message(): Promise<void> {
    if (!this.writer) {
      this.step_pending = false;
      return;
    }
    await this.writer.complete();
    this.writer = null;
  }

  /** 追加 Action 产生的封闭 Assistant 内容。 */
  async append_result_parts(parts: readonly SessionAssistantResultPart[]): Promise<void> {
    if (parts.length === 0) return;
    await (await this.ensure_writer()).append_result_parts(parts);
  }

  /** 按 Turn 结果收口最后一个 canonical Message。 */
  async finish(input: {
    /** Assistant 最终状态。 */
    status: "completed" | "failed" | "stopped";
    /** 失败信息。 */
    error?: string;
  }): Promise<void> {
    if (!this.writer) {
      this.step_pending = false;
      return;
    }
    const writer = await this.ensure_writer();
    if (input.status === "stopped") await writer.stop();
    else if (input.status === "completed") await writer.complete();
    else await writer.fail(input.error);
    this.writer = null;
  }

  /** 惰性打开当前连续 Assistant 回复的唯一 Writer。 */
  private async ensure_writer(): Promise<SessionAssistantMessageWriter> {
    if (this.writer) return this.writer;
    if (this.writer_task) return await this.writer_task;
    this.writer_task = this.messages.open_assistant_message({
      turn_id: this.turn_id,
    });
    try {
      this.writer = await this.writer_task;
      if (this.step_pending) {
        await this.writer.begin_step();
        this.step_pending = false;
      }
      return this.writer;
    } finally {
      this.writer_task = null;
    }
  }
}

/** 判断标准模型事件是否会产生 canonical Assistant 内容。 */
function is_assistant_content_event(event: ModelStreamEvent): boolean {
  return event.type === "text_start" ||
    event.type === "text_delta" ||
    event.type === "text_finish" ||
    event.type === "reasoning_start" ||
    event.type === "reasoning_delta" ||
    event.type === "reasoning_finish" ||
    event.type === "tool_call_start" ||
    event.type === "tool_call_delta" ||
    event.type === "tool_call_finish";
}
