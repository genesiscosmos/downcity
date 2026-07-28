/**
 * Executor 到 Session canonical Message 的 Assistant 输出端口。
 *
 * 该端口集中隔离 AI SDK 流协议。SessionLoop 只装配端口，不解析 Chunk，具体转换
 * 由 execution Adapter 完成，SessionMessages 仍是唯一 Assistant Message 事实源。
 */

import type { UIMessage, UIMessageChunk } from "ai";
import type { SessionMessageRecordV1 } from "@/executor/types/SessionRecords.js";
import type { SessionToolInputReady } from "@/types/session/SessionTool.js";

/** 单次 Turn 的 Assistant 输出写入端口。 */
export interface SessionAssistantOutput {
  /** 开始一个 Provider Step 的独立 Part 作用域。 */
  begin_step(): Promise<void>;
  /** 写入一个 AI SDK 流式 Chunk。 */
  write_chunk(chunk: UIMessageChunk): Promise<void>;
  /** 使用 Provider 最终快照校验并补齐当前 Step metadata。 */
  finish_step(message: SessionMessageRecordV1): Promise<void>;
  /** 放弃当前未完成 Step 的临时作用域。 */
  abort_step(): Promise<void>;
  /** 在 Tool 实现执行前提交完整输入。 */
  prepare_tool_input(input: SessionToolInputReady): Promise<void>;
  /** User steer 已插入会话后，关闭它之前的当前 Assistant Message。 */
  close_current_message(): Promise<void>;
  /** 把 Action 产生的完整 Parts 追加到当前 canonical Assistant Message。 */
  append_parts(parts: UIMessage["parts"]): Promise<void>;
  /** 按 Turn 最终结果收口 Assistant 输出。 */
  finish(input: {
    /** Assistant 最终状态。 */
    status: "completed" | "failed" | "stopped";
    /** 失败时写入 Assistant Message 的错误文本。 */
    error?: string;
  }): Promise<void>;
}
