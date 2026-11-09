/**
 * Downcity 模型事件到 canonical Assistant Message 的输出 Adapter。
 *
 * Adapter 只负责惰性打开当前连续回复的唯一 Writer，并把标准模型事件、Tool 结果与
 * Action 内容转交给 Writer；`SessionMessages` 始终是唯一事实源。
 */

import type { ModelStreamEvent } from "@downcity/type";
import {
  SessionAgentMessageWriter,
  SessionMessages,
} from "@/session/messages/SessionMessages.js";
import type { SessionAgentContent } from "@downcity/type";
import type { SessionAgentMessagePart } from "@downcity/type";
import type { SessionAssistantOutput } from "@/types/turn/SessionAssistantOutput.js";
import type {
  SessionToolExecutionResult,
  SessionToolInputReady,
} from "@/types/session/SessionTool.js";

/** 单个 Turn 使用的 Assistant 输出 Adapter。 */
export class SessionAssistantOutputAdapter implements SessionAssistantOutput {
  private readonly turn_id: string;
  private readonly messages: SessionMessages;
  /** 当前尚未成功收口的 Writer；持久化失败时保留供重试。 */
  private writer: SessionAgentMessageWriter | null = null;
  /** 包含惰性创建与 pending Step 初始化的共享任务。 */
  private writer_task: Promise<SessionAgentMessageWriter> | null = null;
  /** 已 begin 但尚未绑定 Writer 的 Step，消息边界不能丢弃它。 */
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
    if (this.writer_task) await this.writer_task;
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
  async write_tool_result(result: SessionToolExecutionResult): Promise<import("@downcity/type").SessionAgentToolPart> {
    return await (await this.ensure_writer()).apply_tool_result(result);
  }

  /** 使用模型聚合出的 canonical Parts 校验当前 Step。 */
  async finish_step(parts: SessionAgentMessagePart[]): Promise<void> {
    await (await this.ensure_writer()).finish_step(parts);
  }

  /** 清理异常结束的 Step 作用域。 */
  async abort_step(): Promise<void> {
    if (this.writer_task) await this.writer_task;
    if (this.writer) await this.writer.abort_step();
    this.step_pending = false;
  }

  /**
   * 在 Step 边界关闭当前 Assistant Message，失败时保留原 Writer 供重试。
   * 尚未产生内容的 pending Step 留给下一条 Message，调用方负责等待活跃 Step 完成。
   */
  async close_current_message(): Promise<void> {
    if (this.writer_task) await this.writer_task;
    if (!this.writer) return;
    await this.writer.complete();
    this.writer = null;
  }

  /** 追加 Action 产生的封闭 Assistant 内容。 */
  async append_result_parts(parts: readonly SessionAgentContent[], source_tool_call_id?: string): Promise<SessionAgentMessagePart[]> {
    if (parts.length === 0) return [];
    return await (await this.ensure_writer()).append_result_parts(parts, source_tool_call_id);
  }

  /** 在 Turn 收口产物之前追加用户可见的 canonical Error Part。 */
  async append_error(input: {
    /** 错误影响范围。 */
    scope: "session" | "turn";
    /** 稳定错误码。 */
    code: string;
    /** 用户可见错误信息。 */
    message: string;
    /** 当前错误是否允许重试恢复。 */
    recoverable: boolean;
  }): Promise<void> {
    await (await this.ensure_writer()).append_error(input);
  }

  /** 按 Turn 结果收口最后一个 canonical Message。 */
  async finish(input: {
    /** Assistant 最终状态。 */
    status: "completed" | "failed" | "stopped";
    /** 失败信息。 */
    error?: string;
  }): Promise<void> {
    if (this.writer_task) await this.writer_task;
    if (!this.writer) {
      this.step_pending = false;
      return;
    }
    const writer = await this.ensure_writer();
    if (input.status === "stopped") await writer.stop();
    else if (input.status === "completed") await writer.complete();
    else await writer.fail(input.error);
    this.writer = null;
    this.step_pending = false;
  }

  /** 惰性打开当前连续 Assistant 回复的唯一 Writer。 */
  private async ensure_writer(): Promise<SessionAgentMessageWriter> {
    if (this.writer_task) return await this.writer_task;
    if (this.writer && !this.step_pending) return this.writer;
    this.writer_task = this.open_writer();
    try {
      return await this.writer_task;
    } finally {
      this.writer_task = null;
    }
  }

  /** 建立 Writer 并完成 Step 初始化后，才允许并发调用消费模型事件。 */
  private async open_writer(): Promise<SessionAgentMessageWriter> {
    const writer = this.writer ?? await this.messages.open_agent_message({
      turn_id: this.turn_id,
    });
    this.writer = writer;
    if (this.step_pending) {
      await writer.begin_step();
      this.step_pending = false;
    }
    return writer;
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
