/**
 * 单个 canonical Assistant Message 的流式写入器。
 *
 * Writer 直接消费 Downcity `ModelStreamEvent`，并把模型内容、Tool 状态和 Action 内容
 * 串行写入 `SessionMessages`。它不理解 UI Message 或 Provider 私有事件。
 */

import type { ModelStreamEvent } from "@downcity/type";
import type { SessionMessages } from "@/session/SessionMessages.js";
import { to_session_json_value } from "@/session/messages/SessionJsonValue.js";
import { SessionToolPartGate } from "@/session/messages/SessionToolPartGate.js";
import type { SessionAgentContent } from "@downcity/type";
import type {
  SessionAgentErrorPart,
  SessionAgentMessage,
  SessionAgentMessagePart,
  SessionAgentToolPart,
} from "@downcity/type";
import type {
  SessionToolExecutionResult,
  SessionToolInputReady,
} from "@/types/session/SessionTool.js";
import { generate_id } from "@/utils/Id.js";
import { create_session_agent_content_part } from "@/session/messages/SessionAgentContent.js";
import {
  is_agent_part_type,
  merge_agent_part,
  next_agent_part_sequence,
} from "@/session/messages/SessionAgentParts.js";

/** 单个 Assistant Message 的流式 Writer。 */
export class SessionAgentMessageWriter {
  /** 当前 canonical Assistant Message 标识。 */
  readonly message_id: string;

  private readonly recorder: SessionMessages;
  private readonly content_part_ids = new Map<string, string>();
  private readonly tool_call_ids = new Map<string, string>();
  private readonly current_step_part_ids = new Set<string>();
  private readonly tool_part_gate = new SessionToolPartGate();
  private write_chain: Promise<void> = Promise.resolve();
  private step_index = 0;
  private current_step_id: string | null = null;
  private step_active = false;
  private closed = false;

  constructor(recorder: SessionMessages, message_id: string) {
    this.recorder = recorder;
    this.message_id = message_id;
  }

  /** 建立一个独立模型 Step 的 canonical Part 作用域。 */
  async begin_step(): Promise<void> {
    await this.enqueue_write(async () => {
      if (this.closed) throw new Error("Assistant Message writer is closed");
      if (this.step_active) {
        throw new Error("Assistant canonical step is already active");
      }
      this.step_index += 1;
      this.current_step_id = `step:${this.message_id}:${this.step_index}`;
      this.step_active = true;
      this.content_part_ids.clear();
      this.tool_call_ids.clear();
      this.current_step_part_ids.clear();
    });
  }

  /** 直接把单个标准模型事件写入 canonical Assistant Message。 */
  async apply_model_event(event: ModelStreamEvent): Promise<void> {
    await this.enqueue_write(async () => await this.apply_model_event_serialized(event));
  }

  /** 在 Tool 实现执行前提交完整输入，供审批与执行状态共同使用。 */
  async prepare_tool_input(input: SessionToolInputReady): Promise<void> {
    await this.tool_part_gate.wait_until_available(input.tool_call_id);
    await this.enqueue_write(async () => {
      const tool = this.require_tool(input.tool_call_id);
      if (
        tool.state !== "input-streaming" &&
        tool.state !== "ready" &&
        tool.state !== "waiting-user" &&
        tool.state !== "running"
      ) {
        throw new Error(
          `Tool input cannot be prepared from ${tool.state}: ${input.tool_call_id}`,
        );
      }
      await this.upsert_tool(input.tool_call_id, {
        tool_name: input.tool_name,
        state: "ready",
        input: to_session_json_value(input.input),
      });
      await this.recorder.checkpoint_agent_message(this.message_id);
    });
  }

  /** 把 Tool 执行终态直接写入对应 canonical Tool Part。 */
  async apply_tool_result(result: SessionToolExecutionResult): Promise<void> {
    await this.enqueue_write(async () => {
      const tool = this.require_tool(result.tool_call_id);
      if (tool.state === "failed" && result.succeeded) return;
      await this.upsert_tool(result.tool_call_id, result.succeeded
        ? {
            tool_name: result.tool_name,
            state: "completed",
            output: to_session_json_value(result.output),
          }
        : {
            tool_name: result.tool_name,
            state: "failed",
            error: read_tool_error(result.output),
          });
      await this.recorder.checkpoint_agent_message(this.message_id);
    });
  }

  /**
   * 校验当前 Step 最终 canonical Part 快照。
   *
   * 最终快照不能创建、删除或重排模型 Part；不一致意味着事件链不完整。
   */
  async finish_step(parts: SessionAgentMessagePart[]): Promise<void> {
    await this.enqueue_write(async () => {
      if (!this.step_active) {
        throw new Error("Assistant canonical step is not active");
      }
      const current = this.current_message();
      const current_parts = current.parts.filter((part) =>
        this.current_step_part_ids.has(part.part_id)
      );
      if (current_parts.length !== parts.length) {
        throw this.step_snapshot_error(
          `part count ${current_parts.length} != ${parts.length}`,
        );
      }
      const merged_parts = new Map<string, SessionAgentMessagePart>();
      for (let index = 0; index < current_parts.length; index += 1) {
        const current_part = current_parts[index];
        const final_part = parts[index];
        merged_parts.set(
          current_part.part_id,
          this.merge_step_part(current_part, final_part, index),
        );
      }
      await this.recorder.commit_agent_step(
        this.message_id,
        current.parts.map((part) => merged_parts.get(part.part_id) ?? part),
      );
      this.reset_step_state();
    });
  }

  /** 释放异常 Step，并丢弃最近检查点之后的运行投影。 */
  async abort_step(): Promise<void> {
    await this.enqueue_write(async () => {
      this.tool_part_gate.reject_pending("Assistant canonical step was aborted");
      if (this.step_active) {
        await this.recorder.rollback_agent_projection(this.message_id);
        this.reset_step_state();
      }
    });
  }

  /** 把 Action 产生的封闭内容追加到当前 Assistant Message。 */
  async append_result_parts(parts: readonly SessionAgentContent[]): Promise<SessionAgentMessagePart[]> {
    return await this.enqueue_write(async () => {
      if (this.closed) throw new Error("Assistant Message writer is closed");
      const appended_parts: SessionAgentMessagePart[] = [];
      let sequence = this.next_part_sequence();
      for (const part of parts) {
        const canonical = create_session_agent_content_part(
          part,
          `${part.type}:${generate_id()}`,
          sequence,
        );
        appended_parts.push(canonical);
        sequence += 1;
      }
      await this.recorder.commit_agent_parts(this.message_id, appended_parts);
      return appended_parts;
    });
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
    await this.enqueue_write(async () => {
      if (this.closed) throw new Error("Assistant Message writer is closed");
      const part = {
        part_id: `error:${generate_id()}`,
        sequence: this.next_part_sequence(),
        type: "error",
        scope: input.scope,
        code: input.code,
        message: input.message,
        recoverable: input.recoverable,
      } satisfies SessionAgentErrorPart;
      await this.recorder.commit_agent_parts(this.message_id, [part]);
    });
  }

  /** 写入一个完整 canonical Assistant Part。 */
  async upsert_part(part: SessionAgentMessagePart): Promise<void> {
    this.recorder.project_agent_part(this.message_id, part);
    if (this.step_active) this.current_step_part_ids.add(part.part_id);
  }

  /** 等待当前 Writer 已入队的全部写操作完成。 */
  async flush(): Promise<void> {
    await this.write_chain;
  }

  /** 正常完成当前 Assistant Message。 */
  async complete(): Promise<void> {
    await this.enqueue_write(async () => await this.close_serialized("completed"));
  }

  /** 停止当前 Assistant Message，并保留已有 Parts。 */
  async stop(): Promise<void> {
    await this.enqueue_write(async () => await this.close_serialized("stopped"));
  }

  /** 以失败状态关闭当前 Assistant Message。 */
  async fail(error: unknown): Promise<void> {
    await this.enqueue_write(async () => await this.close_serialized(
      "failed",
      error instanceof Error ? error.message : String(error || ""),
    ));
  }

  /** 在单写队列中应用标准模型事件。 */
  private async apply_model_event_serialized(event: ModelStreamEvent): Promise<void> {
    if (this.closed) throw new Error("Assistant Message writer is closed");
    // model_error 由 Executor 的恢复策略消费；Writer 保留已经写入的草稿事实。
    if (event.type === "model_error") return;
    if (event.type === "text_start" || event.type === "reasoning_start") {
      const type = event.type === "text_start" ? "text" : "reasoning";
      const part_id = `${type}:${generate_id()}`;
      this.content_part_ids.set(event.content_id, part_id);
      await this.upsert_part({
        part_id,
        sequence: this.next_part_sequence(),
        step_id: this.require_step_id(),
        type,
        text: "",
        state: "streaming",
      });
      return;
    }
    if (event.type === "text_delta" || event.type === "reasoning_delta") {
      if (!event.delta) return;
      const type = event.type === "text_delta" ? "text" : "reasoning";
      const part_id = this.require_content_part_id(event.content_id);
      this.recorder.project_agent_delta(
        this.message_id,
        part_id,
        type,
        event.delta,
      );
      return;
    }
    if (event.type === "text_finish" || event.type === "reasoning_finish") {
      const part_id = this.require_content_part_id(event.content_id);
      const part = this.current_message().parts.find((item) => item.part_id === part_id);
      if (!part || (part.type !== "text" && part.type !== "reasoning")) {
        throw new Error(`Assistant content Part not found: ${event.content_id}`);
      }
      await this.upsert_part({
        ...part,
        state: "done",
        ...(event.type === "reasoning_finish" && event.signature
          ? { reasoning_signature: event.signature }
          : {}),
      });
      return;
    }
    if (event.type === "tool_call_start") {
      this.tool_call_ids.set(event.content_id, event.tool_call_id);
      await this.create_tool(event.tool_call_id, {
        tool_name: event.tool_name,
        state: "input-streaming",
        input_text: "",
      });
      this.tool_part_gate.mark_available(event.tool_call_id);
      return;
    }
    if (event.type === "tool_call_delta") {
      if (!event.input_delta) return;
      const tool_call_id = this.require_tool_call_id(event.content_id);
      const tool = this.require_tool(tool_call_id);
      this.recorder.project_agent_tool_input_delta(
        this.message_id,
        tool.part_id,
        tool_call_id,
        event.input_delta,
      );
      return;
    }
    if (event.type === "tool_call_finish") {
      const tool_call_id = this.require_tool_call_id(event.content_id);
      const tool = this.require_tool(tool_call_id);
      await this.upsert_tool(tool_call_id, {
        tool_name: tool.tool_name,
        state: event.input_error ? "failed" : "ready",
        input: event.input,
        ...(event.input_error ? { error: event.input_error } : {}),
      });
    }
  }

  /** 读取当前 Assistant Message 快照。 */
  private current_message(): SessionAgentMessage {
    const message = this.recorder.get_message(this.message_id);
    if (!message || message.role !== "agent") {
      throw new Error(`Assistant Message not found: ${this.message_id}`);
    }
    return message;
  }

  /** 查找当前 Assistant 中的指定 Tool Part。 */
  private find_tool(tool_call_id: string): SessionAgentToolPart | undefined {
    return this.current_message().parts.find(
      (part): part is SessionAgentToolPart =>
        part.type === "tool" && part.tool_call_id === tool_call_id,
    );
  }

  /** 读取指定 Tool Part，否则抛出稳定错误。 */
  private require_tool(tool_call_id: string): SessionAgentToolPart {
    const tool = this.find_tool(tool_call_id);
    if (tool) return tool;
    throw new Error(`Assistant canonical Tool Part not found: ${tool_call_id}`);
  }

  /** 读取当前 Step content_id 对应的 canonical Part。 */
  private require_content_part_id(content_id: string): string {
    const part_id = this.content_part_ids.get(content_id);
    if (part_id) return part_id;
    throw new Error(`Assistant content_id not found: ${content_id}`);
  }

  /** 读取当前 Step content_id 对应的 Tool Call。 */
  private require_tool_call_id(content_id: string): string {
    const tool_call_id = this.tool_call_ids.get(content_id);
    if (tool_call_id) return tool_call_id;
    throw new Error(`Assistant Tool content_id not found: ${content_id}`);
  }

  /** 更新已经由模型事件创建的 Tool Part。 */
  private async upsert_tool(
    tool_call_id: string,
    changes: Pick<SessionAgentToolPart, "tool_name" | "state"> &
      Partial<Omit<SessionAgentToolPart, "part_id" | "type" | "tool_call_id" | "tool_name" | "state">>,
  ): Promise<void> {
    const current = this.require_tool(tool_call_id);
    await this.upsert_part({ ...current, ...changes });
  }

  /** 创建由模型事件声明的 Tool Part。 */
  private async create_tool(
    tool_call_id: string,
    changes: Pick<SessionAgentToolPart, "tool_name" | "state"> &
      Partial<Omit<SessionAgentToolPart, "part_id" | "type" | "tool_call_id" | "tool_name" | "state">>,
  ): Promise<void> {
    if (this.find_tool(tool_call_id)) {
      throw new Error(`Assistant canonical Tool Part already exists: ${tool_call_id}`);
    }
    await this.upsert_part({
      part_id: `tool:${tool_call_id}`,
      sequence: this.next_part_sequence(),
      step_id: this.require_step_id(),
      type: "tool",
      tool_call_id,
      ...changes,
    });
  }

  /** 校验并合并同一位置的 canonical Part 与 Step 最终快照。 */
  private merge_step_part(
    current_part: SessionAgentMessagePart,
    final_part: SessionAgentMessagePart,
    index: number,
  ): SessionAgentMessagePart {
    if (current_part.type !== final_part.type) {
      throw this.step_snapshot_error(
        `part ${index + 1} type ${current_part.type} != ${final_part.type}`,
      );
    }
    const same_text = is_agent_part_type(current_part, "text")
      && is_agent_part_type(final_part, "text");
    const same_reasoning = is_agent_part_type(current_part, "reasoning")
      && is_agent_part_type(final_part, "reasoning");
    if ((same_text || same_reasoning) && current_part.text !== final_part.text) {
      throw this.step_snapshot_error(`part ${index + 1} text differs`);
    }
    if (
      is_agent_part_type(current_part, "tool") &&
      is_agent_part_type(final_part, "tool") &&
      current_part.tool_call_id !== final_part.tool_call_id
    ) {
      throw this.step_snapshot_error(`part ${index + 1} tool_call_id differs`);
    }
    const type = final_part.type;
    if (is_agent_part_type(current_part, type) && is_agent_part_type(final_part, type)) {
      return merge_agent_part(current_part, final_part);
    }
    throw this.step_snapshot_error(`part ${index + 1} type ${type} cannot be merged`);
  }

  /** 构造不包含正文与 Tool 输出的结构化 Step 快照错误。 */
  private step_snapshot_error(detail: string): Error {
    return new Error(
      `Assistant canonical step ${this.step_index} snapshot mismatch: ${detail}`,
    );
  }

  /** 清理当前 Step 的临时关联状态。 */
  private reset_step_state(): void {
    this.step_active = false;
    this.current_step_id = null;
    this.content_part_ids.clear();
    this.tool_call_ids.clear();
    this.current_step_part_ids.clear();
  }

  /** 返回当前模型 Step 的稳定标识。 */
  private require_step_id(): string {
    if (this.step_active && this.current_step_id) return this.current_step_id;
    throw new Error("Assistant canonical step is not active");
  }

  /** 计算下一个不可变 Part 顺序号。 */
  private next_part_sequence(): number {
    return next_agent_part_sequence(this.current_message().parts);
  }

  /** 串行执行对当前 Assistant Message 的全部写操作。 */
  private async enqueue_write<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const current = this.write_chain.then(operation, operation);
    this.write_chain = current.then(() => undefined, () => undefined);
    return await current;
  }

  /** 在队列内关闭当前 Assistant Message。 */
  private async close_serialized(
    status: "completed" | "stopped" | "failed",
    error?: string,
  ): Promise<void> {
    if (this.closed) return;
    this.tool_part_gate.close(
      `Assistant Message writer closed with status ${status}`,
    );
    this.reset_step_state();
    await this.recorder.complete_agent_message(this.message_id, status, error);
    this.closed = true;
  }
}

/** 从 Tool 失败输出中提取稳定错误文本。 */
function read_tool_error(output: unknown): string {
  for (const candidate of read_tool_error_candidates(output)) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "Tool execution failed";
}

/** 读取 Tool 失败输出中可能携带错误文本的字段。 */
function read_tool_error_candidates(output: unknown): unknown[] {
  if (typeof output !== "object" || output === null) return [];
  return [
    "error" in output ? output.error : undefined,
    "message" in output ? output.message : undefined,
    "output" in output ? output.output : undefined,
  ];
}
