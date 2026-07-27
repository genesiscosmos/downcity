/**
 * AI SDK Assistant 输出到 Session canonical Message 的协议 Adapter。
 *
 * 本模块是 AI SDK 临时 ID、空 Part 与最终 UIMessage 快照能进入的最外层边界。
 * 它只通过 SessionMessages 打开 Writer，不持有第二份 Assistant Message 状态。
 */

import type { SessionMessageRecordV1 } from "@/executor/types/SessionRecords.js";
import { from_ui_assistant_parts } from "@/session/messages/SessionMessageCodec.js";
import {
  SessionAssistantMessageWriter,
  SessionMessages,
} from "@/session/SessionMessages.js";
import type { SessionAssistantOutput } from "@/types/executor/SessionAssistantOutput.js";
import type { SessionToolInputReady } from "@/types/session/SessionTool.js";
import type { FileUIPart, UIMessageChunk } from "ai";

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

  /** 开始当前 Provider Step。 */
  async begin_step(): Promise<void> {
    if (this.writer) {
      await this.writer.begin_step();
      return;
    }
    this.step_pending = true;
  }

  /** 把可持久化 AI SDK Chunk 写入当前 canonical Message。 */
  async write_chunk(chunk: UIMessageChunk): Promise<void> {
    if (!is_assistant_content_chunk(chunk.type)) return;
    await (await this.ensure_writer()).apply_chunk(chunk);
  }

  /** 使用最终快照校验当前 Step Part 顺序并补齐 metadata。 */
  async finish_step(message: SessionMessageRecordV1): Promise<void> {
    await (await this.ensure_writer()).finish_step(
      from_ui_assistant_parts(message.parts),
    );
  }

  /** 清理异常结束的 Step 作用域。 */
  async abort_step(): Promise<void> {
    if (this.writer) await this.writer.abort_step();
    this.step_pending = false;
  }

  /** 在 Tool 实现开始前提交完整输入。 */
  async prepare_tool_input(input: SessionToolInputReady): Promise<void> {
    await (await this.ensure_writer()).prepare_tool_input(input);
  }

  /** User steer 已持久化后关闭当前 Assistant Message；没有输出时保持为空。 */
  async close_current_message(): Promise<void> {
    if (!this.writer) {
      this.step_pending = false;
      return;
    }
    await this.writer.complete();
    this.writer = null;
  }

  /** 追加 Tool 文件并按 Turn 结果收口最后一个 canonical Message。 */
  async finish(input: {
    /** Assistant 最终状态。 */
    status: "completed" | "failed" | "stopped";
    /** 失败信息。 */
    error?: string;
    /** Tool 生成的最终文件 Part。 */
    file_parts: FileUIPart[];
  }): Promise<void> {
    if (!this.writer && input.file_parts.length === 0) {
      this.step_pending = false;
      return;
    }
    const writer = await this.ensure_writer();
    for (const part of from_ui_assistant_parts(input.file_parts)) {
      if (part.type === "file") await writer.append_file_part(part);
    }
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

/** 判断 AI SDK Chunk 是否属于 canonical Assistant 内容。 */
function is_assistant_content_chunk(type: string): boolean {
  return (
    type === "text-start" ||
    type === "text-delta" ||
    type === "text-end" ||
    type === "reasoning-start" ||
    type === "reasoning-delta" ||
    type === "reasoning-end" ||
    type.startsWith("tool-") ||
    type === "file" ||
    type === "source-url" ||
    type === "source-document" ||
    type === "start-step" ||
    type.startsWith("data-")
  );
}
