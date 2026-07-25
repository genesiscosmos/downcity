/**
 * 单个 Assistant Message 的流式写入器。
 *
 * Writer 把 AI SDK chunk、Executor Tool 输入屏障和最终关闭操作收口到同一条
 * 单写者队列，保证并发回调不会产生 revision 冲突。
 */

import type { UIMessageChunk } from "ai";
import type { SessionMessages } from "@/session/SessionMessages.js";
import {
  to_session_json_object,
  to_session_json_value,
  to_session_provider_metadata,
} from "@/session/messages/SessionJsonValue.js";
import { SessionToolPartGate } from "@/session/messages/SessionToolPartGate.js";
import type {
  SessionAssistantFilePart,
  SessionAssistantMessage,
  SessionAssistantMessagePart,
  SessionAssistantTextPart,
  SessionAssistantToolPart,
} from "@/types/session/SessionMessage.js";
import type { SessionToolInputReady } from "@/types/session/SessionTool.js";
import { generate_id } from "@/utils/Id.js";

/** 单个 Assistant segment 的流式 writer。 */
export class SessionAssistantMessageWriter {
  readonly message_id: string;
  private readonly recorder: SessionMessages;
  private readonly pending_text_parts = new Map<
    string,
    Pick<SessionAssistantTextPart, "type" | "provider_metadata">
  >();
  private readonly active_text_part_ids = new Map<string, string>();
  private readonly current_step_part_ids = new Set<string>();
  private readonly tool_part_gate = new SessionToolPartGate();
  private write_chain: Promise<void> = Promise.resolve();
  private step_index = 0;
  private step_active = false;
  private closed = false;

  constructor(recorder: SessionMessages, message_id: string) {
    this.recorder = recorder;
    this.message_id = message_id;
  }

  /** 应用一个原始 AI SDK UI chunk。 */
  async apply_chunk(chunk: UIMessageChunk): Promise<void> {
    await this.enqueue_write(async () => {
      await this.apply_chunk_serialized(chunk);
    });
  }

  /** 建立一个独立模型 UI stream 的 canonical step 作用域。 */
  async begin_step(): Promise<void> {
    await this.enqueue_write(async () => {
      if (this.closed) throw new Error("Assistant Message writer is closed");
      if (this.step_active) {
        throw new Error("Assistant canonical step is already active");
      }
      this.step_index += 1;
      this.step_active = true;
      this.current_step_part_ids.clear();
      this.pending_text_parts.clear();
      this.active_text_part_ids.clear();
    });
  }

  /**
   * 校验当前 step 的最终快照并原子补充 metadata。
   *
   * 最终快照不能创建、删除或重排 Part；任何不一致都表示 canonical chunk
   * 链路不完整，必须让当前 Turn 失败。
   */
  async finish_step(parts: SessionAssistantMessagePart[]): Promise<void> {
    await this.enqueue_write(async () => {
      if (!this.step_active) {
        throw new Error("Assistant canonical step is not active");
      }
      const current = this.current_message();
      const current_step_parts = current.parts.filter(
        (part) =>
          this.current_step_part_ids.has(part.part_id) &&
          part.type !== "step-start",
      );
      const final_step_parts = parts.filter((part) => part.type !== "step-start");
      if (current_step_parts.length !== final_step_parts.length) {
        throw this.step_snapshot_error(
          `part count ${current_step_parts.length} != ${final_step_parts.length}`,
        );
      }

      const merged_parts = new Map<string, SessionAssistantMessagePart>();
      for (let index = 0; index < current_step_parts.length; index += 1) {
        const current_part = current_step_parts[index];
        const final_part = final_step_parts[index];
        merged_parts.set(
          current_part.part_id,
          this.merge_step_part(current_part, final_part, index),
        );
      }
      await this.recorder.commit_assistant_step(
        this.message_id,
        current.parts.map((part) => merged_parts.get(part.part_id) || part),
      );
      this.reset_step_state();
    });
  }

  /** 释放异常结束的 step 作用域并保留已经写入的 canonical Parts。 */
  async abort_step(): Promise<void> {
    await this.enqueue_write(async () => {
      this.tool_part_gate.reject_pending("Assistant canonical step was aborted");
      if (this.step_active) this.reset_step_state();
    });
  }

  /** 在当前 Assistant writer 的单写者队列中应用原始 chunk。 */
  private async apply_chunk_serialized(chunk: UIMessageChunk): Promise<void> {
    if (this.closed) throw new Error("Assistant Message writer is closed");
    const current = this.current_message();
    switch (chunk.type) {
      case "text-start":
      case "reasoning-start": {
        const type = chunk.type === "text-start" ? "text" : "reasoning";
        const part_id = this.resolve_text_part_id(type, chunk.id);
        if (!current.parts.some((part) => part.part_id === part_id)) {
          this.pending_text_parts.set(part_id, {
            type,
            provider_metadata: to_session_provider_metadata(chunk.providerMetadata),
          });
        }
        return;
      }
      case "text-delta":
      case "reasoning-delta": {
        const type = chunk.type === "text-delta" ? "text" : "reasoning";
        const part_id = this.resolve_text_part_id(type, chunk.id);
        await this.ensure_text_part(
          part_id,
          type,
          to_session_provider_metadata(chunk.providerMetadata),
        );
        await this.recorder.append_assistant_delta(
          this.message_id,
          part_id,
          type,
          chunk.delta,
        );
        return;
      }
      case "text-end":
      case "reasoning-end": {
        const type = chunk.type === "text-end" ? "text" : "reasoning";
        const source_part_id = this.source_text_part_id(type, chunk.id);
        const part_id = this.active_text_part_ids.get(source_part_id);
        if (!part_id) return;
        const part = current.parts.find((item) => item.part_id === part_id);
        if (part?.type === "text" || part?.type === "reasoning") {
          const provider_metadata = to_session_provider_metadata(chunk.providerMetadata);
          await this.upsert_part({
            ...part,
            state: "done",
            ...(provider_metadata !== undefined ? { provider_metadata } : {}),
          });
        } else {
          this.pending_text_parts.delete(part_id);
        }
        this.active_text_part_ids.delete(source_part_id);
        return;
      }
      case "tool-input-start": {
        const tool = this.find_tool(chunk.toolCallId);
        const call_provider_metadata = to_session_provider_metadata(
          chunk.providerMetadata,
        );
        const tool_metadata = to_session_json_object(chunk.toolMetadata);
        if (tool) {
          if (
            call_provider_metadata === undefined &&
            chunk.providerExecuted === undefined &&
            chunk.title === undefined &&
            tool_metadata === undefined &&
            chunk.dynamic === undefined
          ) return;
          await this.upsert_tool(chunk.toolCallId, {
            tool_name: tool.tool_name,
            state: tool.state,
            ...(call_provider_metadata !== undefined
              ? { call_provider_metadata }
              : {}),
            ...(chunk.providerExecuted !== undefined
              ? { provider_executed: chunk.providerExecuted }
              : {}),
            ...(chunk.title !== undefined ? { title: chunk.title } : {}),
            ...(tool_metadata !== undefined ? { tool_metadata } : {}),
            ...(chunk.dynamic !== undefined ? { dynamic: chunk.dynamic } : {}),
          });
          return;
        }
        await this.create_tool(chunk.toolCallId, {
          tool_name: chunk.toolName,
          state: "input-streaming",
          input_text: "",
          ...(call_provider_metadata !== undefined
            ? { call_provider_metadata }
            : {}),
          ...(chunk.providerExecuted !== undefined
            ? { provider_executed: chunk.providerExecuted }
            : {}),
          ...(chunk.title !== undefined ? { title: chunk.title } : {}),
          ...(tool_metadata !== undefined ? { tool_metadata } : {}),
          ...(chunk.dynamic !== undefined ? { dynamic: chunk.dynamic } : {}),
        });
        this.tool_part_gate.mark_available(chunk.toolCallId);
        return;
      }
      case "tool-input-delta": {
        const tool = this.find_tool(chunk.toolCallId);
        if (tool && tool.state !== "input-streaming") return;
        await this.upsert_tool(chunk.toolCallId, {
          tool_name: tool?.tool_name || "unknown",
          state: "input-streaming",
          input_text: `${tool?.input_text || ""}${chunk.inputTextDelta}`,
        });
        return;
      }
      case "tool-input-available": {
        const tool = this.find_tool(chunk.toolCallId);
        const call_provider_metadata = to_session_provider_metadata(
          chunk.providerMetadata,
        );
        const tool_metadata = to_session_json_object(chunk.toolMetadata);
        if (tool && tool.state !== "input-streaming") {
          if (
            call_provider_metadata === undefined &&
            chunk.providerExecuted === undefined &&
            chunk.title === undefined &&
            tool_metadata === undefined &&
            chunk.dynamic === undefined
          ) return;
          await this.upsert_tool(chunk.toolCallId, {
            tool_name: tool.tool_name,
            state: tool.state,
            ...(call_provider_metadata !== undefined
              ? { call_provider_metadata }
              : {}),
            ...(chunk.providerExecuted !== undefined
              ? { provider_executed: chunk.providerExecuted }
              : {}),
            ...(chunk.title !== undefined ? { title: chunk.title } : {}),
            ...(tool_metadata !== undefined ? { tool_metadata } : {}),
            ...(chunk.dynamic !== undefined ? { dynamic: chunk.dynamic } : {}),
          });
          return;
        }
        const changes = {
          tool_name: chunk.toolName,
          state: "ready",
          input: to_session_json_value(chunk.input),
          ...(call_provider_metadata !== undefined
            ? { call_provider_metadata }
            : {}),
          ...(chunk.providerExecuted !== undefined
            ? { provider_executed: chunk.providerExecuted }
            : {}),
          ...(chunk.title !== undefined ? { title: chunk.title } : {}),
          ...(tool_metadata !== undefined ? { tool_metadata } : {}),
          ...(chunk.dynamic !== undefined ? { dynamic: chunk.dynamic } : {}),
        } as const;
        if (tool) {
          await this.upsert_tool(chunk.toolCallId, changes);
        } else {
          await this.create_tool(chunk.toolCallId, changes);
          this.tool_part_gate.mark_available(chunk.toolCallId);
        }
        return;
      }
      case "tool-input-error": {
        const call_provider_metadata = to_session_provider_metadata(
          chunk.providerMetadata,
        );
        const tool_metadata = to_session_json_object(chunk.toolMetadata);
        await this.upsert_tool(chunk.toolCallId, {
          tool_name: chunk.toolName,
          state: "failed",
          input: to_session_json_value(chunk.input),
          error: chunk.errorText,
          ...(chunk.input === undefined && "rawInput" in chunk && chunk.rawInput !== undefined
            ? { raw_input: to_session_json_value(chunk.rawInput) }
            : {}),
          ...(call_provider_metadata !== undefined
            ? { call_provider_metadata }
            : {}),
          ...(chunk.providerExecuted !== undefined
            ? { provider_executed: chunk.providerExecuted }
            : {}),
          ...(chunk.title !== undefined ? { title: chunk.title } : {}),
          ...(tool_metadata !== undefined ? { tool_metadata } : {}),
          ...(chunk.dynamic !== undefined ? { dynamic: chunk.dynamic } : {}),
        });
        return;
      }
      case "tool-approval-request": {
        const tool = this.find_tool(chunk.toolCallId);
        await this.upsert_tool(chunk.toolCallId, {
          tool_name: tool?.tool_name || "unknown",
          state: "approval-required",
          approval: { approval_id: chunk.approvalId },
        });
        return;
      }
      case "tool-output-available": {
        const tool = this.find_tool(chunk.toolCallId);
        if (
          tool?.state === "failed" &&
          (tool.error === "Approval denied" || tool.error === "Approval expired")
        ) return;
        const result_provider_metadata = to_session_provider_metadata(
          chunk.providerMetadata,
        );
        const tool_metadata = to_session_json_object(chunk.toolMetadata);
        await this.upsert_tool(chunk.toolCallId, {
          tool_name: tool?.tool_name || "unknown",
          state: "completed",
          output: to_session_json_value(chunk.output),
          ...(result_provider_metadata !== undefined
            ? { result_provider_metadata }
            : {}),
          ...(chunk.providerExecuted !== undefined
            ? { provider_executed: chunk.providerExecuted }
            : {}),
          ...(tool_metadata !== undefined ? { tool_metadata } : {}),
          ...(chunk.dynamic !== undefined ? { dynamic: chunk.dynamic } : {}),
          ...(chunk.preliminary !== undefined
            ? { preliminary: chunk.preliminary }
            : {}),
        });
        return;
      }
      case "tool-output-error": {
        const tool = this.find_tool(chunk.toolCallId);
        const result_provider_metadata = to_session_provider_metadata(
          chunk.providerMetadata,
        );
        const tool_metadata = to_session_json_object(chunk.toolMetadata);
        await this.upsert_tool(chunk.toolCallId, {
          tool_name: tool?.tool_name || "unknown",
          state: "failed",
          error: chunk.errorText,
          ...(result_provider_metadata !== undefined
            ? { result_provider_metadata }
            : {}),
          ...(chunk.providerExecuted !== undefined
            ? { provider_executed: chunk.providerExecuted }
            : {}),
          ...(tool_metadata !== undefined ? { tool_metadata } : {}),
          ...(chunk.dynamic !== undefined ? { dynamic: chunk.dynamic } : {}),
        });
        return;
      }
      case "tool-output-denied": {
        const tool = this.find_tool(chunk.toolCallId);
        await this.upsert_tool(chunk.toolCallId, {
          tool_name: tool?.tool_name || "unknown",
          state: "failed",
          error: "Tool output denied",
          approval: {
            ...(tool?.approval || {}),
            approval_id:
              tool?.approval?.approval_id || `approval:${chunk.toolCallId}`,
            approved: false,
          },
        });
        return;
      }
      case "file":
        await this.append_file_part({
          media_type: chunk.mediaType,
          url: chunk.url,
          provider_metadata: to_session_provider_metadata(chunk.providerMetadata),
        });
        return;
      case "source-url": {
        const part_id = `source:${this.step_index}:${chunk.sourceId}`;
        const current_part = current.parts.find((part) => part.part_id === part_id);
        const provider_metadata = to_session_provider_metadata(chunk.providerMetadata);
        await this.upsert_part({
          part_id,
          sequence: current_part?.sequence || this.next_part_sequence(),
          type: "source",
          source_type: "url",
          source_id: chunk.sourceId,
          url: chunk.url,
          ...(chunk.title !== undefined ? { title: chunk.title } : {}),
          ...(provider_metadata !== undefined
            ? { provider_metadata }
            : {}),
        });
        return;
      }
      case "source-document": {
        const part_id = `source:${this.step_index}:${chunk.sourceId}`;
        const current_part = current.parts.find((part) => part.part_id === part_id);
        const provider_metadata = to_session_provider_metadata(chunk.providerMetadata);
        await this.upsert_part({
          part_id,
          sequence: current_part?.sequence || this.next_part_sequence(),
          type: "source",
          source_type: "document",
          source_id: chunk.sourceId,
          media_type: chunk.mediaType,
          title: chunk.title,
          ...(chunk.filename !== undefined ? { filename: chunk.filename } : {}),
          ...(provider_metadata !== undefined
            ? { provider_metadata }
            : {}),
        });
        return;
      }
      case "start-step":
        await this.upsert_part({
          part_id: `step:${generate_id()}`,
          sequence: this.next_part_sequence(),
          type: "step-start",
        });
        return;
      default: {
        if (chunk.type.startsWith("data-")) {
          const data_chunk = chunk as unknown as Record<string, unknown>;
          if (data_chunk.transient === true) return;
          const data_id = typeof data_chunk.id === "string"
            ? data_chunk.id
            : undefined;
          const part_id = data_id
            ? `data:${this.step_index}:${data_id}`
            : `data:${generate_id()}`;
          const current_part = current.parts.find((part) => part.part_id === part_id);
          await this.upsert_part({
            part_id,
            sequence: current_part?.sequence || this.next_part_sequence(),
            type: "data",
            data_type: chunk.type,
            data: to_session_json_value(data_chunk.data),
            ...(data_id !== undefined ? { data_id } : {}),
          });
        }
        return;
      }
    }
  }

  /** 写入一个完整 Assistant part。 */
  async upsert_part(part: SessionAssistantMessagePart): Promise<void> {
    await this.recorder.update_assistant_part(this.message_id, part);
    if (this.step_active) this.current_step_part_ids.add(part.part_id);
  }

  /** Executor 在调用 Tool 实现前写入完整输入。 */
  async prepare_tool_input(input: SessionToolInputReady): Promise<void> {
    await this.tool_part_gate.wait_until_available(input.tool_call_id);
    await this.enqueue_write(async () => {
      if (this.closed) throw new Error("Assistant Message writer is closed");
      const current = this.find_tool(input.tool_call_id);
      if (!current) {
        throw new Error(
          `Assistant canonical Tool Part not found: ${input.tool_call_id}`,
        );
      }
      if (current.state !== "input-streaming" && current.state !== "ready") {
        throw new Error(
          `Tool input cannot be prepared from ${current.state}: ${input.tool_call_id}`,
        );
      }
      await this.write_prepared_tool_input(input);
    });
  }

  /** 把最终结果中的文件补入当前 Assistant，并对流式已写入文件去重。 */
  async append_file_part(
    input: Pick<
      SessionAssistantFilePart,
      "filename" | "media_type" | "provider_metadata" | "url"
    >,
  ): Promise<void> {
    const filename = String(input.filename || "").trim();
    const current = this.current_message();
    const existing = current.parts.find(
      (part) =>
        part.type === "file" &&
        (!this.step_active || this.current_step_part_ids.has(part.part_id)) &&
        part.url === input.url &&
        part.media_type === input.media_type,
    );
    if (existing?.type === "file") {
      if (
        (filename && String(existing.filename || "").trim() !== filename) ||
        input.provider_metadata !== undefined
      ) {
        await this.upsert_part({
          ...existing,
          ...(filename ? { filename } : {}),
          ...(input.provider_metadata !== undefined
            ? { provider_metadata: input.provider_metadata }
            : {}),
        });
      }
      return;
    }
    await this.upsert_part({
      part_id: `file:${generate_id()}`,
      sequence: this.next_part_sequence(),
      type: "file",
      media_type: input.media_type,
      url: input.url,
      ...(filename ? { filename } : {}),
      ...(input.provider_metadata !== undefined
        ? { provider_metadata: input.provider_metadata }
        : {}),
    });
  }

  /** 等待当前 Assistant writer 已入队的全部写操作完成。 */
  async flush(): Promise<void> {
    await this.write_chain;
  }

  /** 正常完成当前 assistant segment。 */
  async complete(): Promise<void> {
    await this.enqueue_write(async () => {
      await this.close_serialized("completed");
    });
  }

  /** 停止当前 assistant segment，并保留已有 parts。 */
  async stop(): Promise<void> {
    await this.enqueue_write(async () => {
      await this.close_serialized("stopped");
    });
  }

  /** 以失败状态关闭当前 assistant segment。 */
  async fail(_error: unknown): Promise<void> {
    await this.enqueue_write(async () => {
      await this.close_serialized("failed");
    });
  }

  /** 读取当前 Assistant Message 快照。 */
  private current_message(): SessionAssistantMessage {
    const message = this.recorder.get_message(this.message_id);
    if (!message || message.type !== "assistant") {
      throw new Error(`Assistant Message not found: ${this.message_id}`);
    }
    return message;
  }

  /** 读取当前 Assistant 中的指定 Tool Part。 */
  private find_tool(tool_call_id: string): SessionAssistantToolPart | undefined {
    return this.current_message().parts.find(
      (part): part is SessionAssistantToolPart =>
        part.type === "tool" && part.tool_call_id === tool_call_id,
    );
  }

  /** 校验并合并同一位置的 canonical Part 与 step 最终快照。 */
  private merge_step_part(
    current_part: SessionAssistantMessagePart,
    final_part: SessionAssistantMessagePart,
    index: number,
  ): SessionAssistantMessagePart {
    if (current_part.type !== final_part.type) {
      throw this.step_snapshot_error(
        `part ${index + 1} type ${current_part.type} != ${final_part.type}`,
      );
    }
    if (
      (current_part.type === "text" || current_part.type === "reasoning") &&
      (final_part.type === "text" || final_part.type === "reasoning")
    ) {
      if (current_part.text !== final_part.text) {
        throw this.step_snapshot_error(`part ${index + 1} text differs`);
      }
    } else if (current_part.type === "tool" && final_part.type === "tool") {
      if (current_part.tool_call_id !== final_part.tool_call_id) {
        throw this.step_snapshot_error(`part ${index + 1} tool_call_id differs`);
      }
    } else if (current_part.type === "file" && final_part.type === "file") {
      if (
        current_part.url !== final_part.url ||
        current_part.media_type !== final_part.media_type
      ) {
        throw this.step_snapshot_error(`part ${index + 1} file identity differs`);
      }
    } else if (current_part.type === "source" && final_part.type === "source") {
      if (
        current_part.source_type !== final_part.source_type ||
        current_part.source_id !== final_part.source_id
      ) {
        throw this.step_snapshot_error(`part ${index + 1} source identity differs`);
      }
    } else if (current_part.type === "data" && final_part.type === "data") {
      if (
        current_part.data_type !== final_part.data_type ||
        current_part.data_id !== final_part.data_id
      ) {
        throw this.step_snapshot_error(`part ${index + 1} data identity differs`);
      }
    }
    return {
      ...current_part,
      ...final_part,
      part_id: current_part.part_id,
      sequence: current_part.sequence,
    } as SessionAssistantMessagePart;
  }

  /** 构造不包含正文与工具输出的结构化 step 快照错误。 */
  private step_snapshot_error(detail: string): Error {
    return new Error(
      `Assistant canonical step ${this.step_index} snapshot mismatch: ${detail}`,
    );
  }

  /** 清理当前 step 的临时关联状态。 */
  private reset_step_state(): void {
    this.step_active = false;
    this.current_step_part_ids.clear();
    this.pending_text_parts.clear();
    this.active_text_part_ids.clear();
  }

  /** 计算下一个不可变 Part 顺序号。 */
  private next_part_sequence(): number {
    return this.current_message().parts.reduce(
      (value, part) => Math.max(value, part.sequence + 1),
      1,
    );
  }

  /**
   * 把 AI SDK 当前 stream 内的临时 chunk ID 映射为 Message 内唯一 Part ID。
   *
   * AI SDK 会在不同 `streamText()` 调用中重复使用 `txt-0`、`reasoning-0`
   * 等 ID，因此这些 ID 只能用于关联当前尚未结束的文本片段。
   */
  private resolve_text_part_id(
    type: "text" | "reasoning",
    chunk_id: string,
  ): string {
    const source_part_id = this.source_text_part_id(type, chunk_id);
    const active_part_id = this.active_text_part_ids.get(source_part_id);
    if (active_part_id) return active_part_id;
    const part_id = `${type}:${generate_id()}`;
    this.active_text_part_ids.set(source_part_id, part_id);
    return part_id;
  }

  /** 构造当前流片段使用的临时关联键。 */
  private source_text_part_id(
    type: "text" | "reasoning",
    chunk_id: string,
  ): string {
    return `${this.step_index}:${type}:${chunk_id}`;
  }

  /** 在首个有效 Delta 到达时才固定文本 Part 的真实顺序。 */
  private async ensure_text_part(
    part_id: string,
    type: "text" | "reasoning",
    provider_metadata?: SessionAssistantTextPart["provider_metadata"],
  ): Promise<void> {
    const existing = this.current_message().parts.find(
      (part) => part.part_id === part_id,
    );
    if (existing) {
      if (existing.type !== type) {
        throw new Error(`Assistant Part type changed: ${part_id}`);
      }
      if (
        (existing.type === "text" || existing.type === "reasoning") &&
        provider_metadata !== undefined
      ) {
        await this.upsert_part({ ...existing, provider_metadata });
      }
      return;
    }
    const pending = this.pending_text_parts.get(part_id);
    if (pending && pending.type !== type) {
      throw new Error(`Assistant pending Part type changed: ${part_id}`);
    }
    await this.upsert_part({
      part_id,
      sequence: this.next_part_sequence(),
      type,
      text: "",
      state: "streaming",
      ...(provider_metadata !== undefined
        ? { provider_metadata }
        : pending?.provider_metadata !== undefined
          ? { provider_metadata: pending.provider_metadata }
          : {}),
    });
    this.pending_text_parts.delete(part_id);
  }

  /** 更新已经由 canonical stream 创建的 Tool Part。 */
  private async upsert_tool(
    tool_call_id: string,
    changes: Pick<SessionAssistantToolPart, "tool_name" | "state"> &
      Partial<Omit<SessionAssistantToolPart, "part_id" | "type" | "tool_call_id" | "tool_name" | "state">>,
  ): Promise<void> {
    const current = this.find_tool(tool_call_id);
    if (!current) {
      throw new Error(
        `Assistant canonical Tool Part not found: ${tool_call_id}`,
      );
    }
    await this.upsert_part({
      ...current,
      part_id: `tool:${tool_call_id}`,
      sequence: current.sequence,
      type: "tool",
      tool_call_id,
      ...changes,
    });
  }

  /** 仅由 Tool 输入 stream chunk 创建 canonical Tool Part。 */
  private async create_tool(
    tool_call_id: string,
    changes: Pick<SessionAssistantToolPart, "tool_name" | "state"> &
      Partial<Omit<SessionAssistantToolPart, "part_id" | "type" | "tool_call_id" | "tool_name" | "state">>,
  ): Promise<void> {
    if (this.find_tool(tool_call_id)) {
      throw new Error(
        `Assistant canonical Tool Part already exists: ${tool_call_id}`,
      );
    }
    await this.upsert_part({
      part_id: `tool:${tool_call_id}`,
      sequence: this.next_part_sequence(),
      type: "tool",
      tool_call_id,
      ...changes,
    });
  }

  /** 将 Executor 完整输入写入已经由 stream 创建的 Tool Part。 */
  private async write_prepared_tool_input(
    input: SessionToolInputReady,
  ): Promise<void> {
    await this.upsert_tool(input.tool_call_id, {
      tool_name: input.tool_name,
      state: "ready",
      input: to_session_json_value(input.input),
    });
  }

  /** 串行执行对当前 Assistant Message 的全部写操作。 */
  private async enqueue_write(operation: () => Promise<void>): Promise<void> {
    const current = this.write_chain.then(operation, operation);
    this.write_chain = current.catch(() => undefined);
    await current;
  }

  /** 在队列内关闭当前 Assistant Message。 */
  private async close_serialized(
    status: "completed" | "stopped" | "failed",
  ): Promise<void> {
    if (this.closed) return;
    this.tool_part_gate.close(
      `Assistant Message writer closed with status ${status}`,
    );
    this.reset_step_state();
    await this.recorder.complete_assistant_message(this.message_id, status);
    this.closed = true;
  }
}
