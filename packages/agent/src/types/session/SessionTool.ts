/**
 * Session Tool Message 类型。
 *
 * 这些类型描述 Tool 生命周期协调器与 Recorder 之间的稳定边界。
 */

import type { SessionAssistantToolPart } from "@/types/session/SessionMessage.js";

/** 当前流式 Assistant 中的 Tool Part 定位结果。 */
export interface SessionStreamingToolLocation {
  /** Tool Part 所属 Assistant Message。 */
  message_id: string;
  /** 当前 Tool Part 完整快照。 */
  part: SessionAssistantToolPart;
}

/** Executor 在调用 Tool 实现前提交的完整输入。 */
export interface SessionToolInputReady {
  /** 当前 Tool Call 标识。 */
  tool_call_id: string;
  /** 当前 Tool 注册名称。 */
  tool_name: string;
  /** 已完成解析的 Tool 输入。 */
  input: unknown;
}

/** Tool 执行终态输入。 */
export interface SessionToolExecutionResult {
  /** 对应模型 Tool Call 标识。 */
  tool_call_id: string;
  /** 对应工具注册名称。 */
  tool_name: string;
  /** Tool 是否成功执行。 */
  succeeded: boolean;
  /** Tool 返回的可序列化结果。 */
  output: unknown;
}

/** 等待单个 canonical Tool Part 到达的异步句柄。 */
export interface SessionToolPartWaiter {
  /** Tool Part 成功持久化后完成，异常结束时拒绝。 */
  promise: Promise<void>;
  /** Tool Part 已按 canonical 顺序持久化时释放等待。 */
  resolve: () => void;
  /** 当前 step 或 Gate 异常结束时拒绝等待。 */
  reject: (error: Error) => void;
}
