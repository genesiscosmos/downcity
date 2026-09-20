/**
 * 已绑定工具的内部执行协议。
 *
 * 公开契约 `AgentTool` 的执行签名要求完整的 `ToolCallContext`；而模型 Step 只知道
 * 本次调用自身的身份与消息。因此 Agent 在执行前把 AgentTool 包装成 BoundAgentTool：
 * 包装层捕获 Session 级上下文，Step 侧只补本次调用信息，两者在包装层合并。
 *
 * 关键点（中文）
 * - `BoundAgentTool` 不对外暴露，只存在于 Agent 内部的模型 Step 执行路径。
 * - 这一层存在的意义是让上下文注入点唯一：工具实现永远拿到完整的 ToolCallContext。
 */

import type { ModelMessage } from "@downcity/type";

/** 一次模型工具调用自身携带的信息。 */
export interface ToolCallSite {
  /** 当前模型工具调用的稳定唯一标识。 */
  readonly tool_call_id: string;
  /** 当前模型 Step 使用的完整消息快照。 */
  readonly messages: readonly ModelMessage[];
  /** 当前 Turn 的可选取消信号。 */
  readonly abort_signal?: AbortSignal;
}

/** 允许异构工具注册表保留每个工具自己的输入类型。 */
type BoundAgentToolHandler<TInput, TResult> = {
  bivariance_handler(input: TInput, site: ToolCallSite): TResult;
}["bivariance_handler"];

/** 已完成 Session 上下文绑定的工具；执行时只需补充本次调用信息。 */
export interface BoundAgentTool<TInput = unknown, TOutput = unknown> {
  /** 面向模型的工具用途说明。 */
  readonly description?: string;
  /** JSON Schema 或可转换为 JSON Schema 的输入定义。 */
  readonly input_schema: unknown;
  /** 可选执行实现；缺少时该工具只向模型声明能力。 */
  readonly execute?: BoundAgentToolHandler<TInput, TOutput | Promise<TOutput>>;
}
