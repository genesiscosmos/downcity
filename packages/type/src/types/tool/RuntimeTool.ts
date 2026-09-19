/**
 * Downcity 可执行工具协议模块。
 *
 * 本模块只定义进程内工具注册表的最小契约。模型可见的可传输工具定义仍由
 * `ModelTool` 表达，执行函数不会进入 ModelCall 或网络协议。
 */

import type { ModelMessage } from "../model/ModelMessage.js";

/** 允许异构工具注册表保留每个工具自己的输入类型。 */
type RuntimeToolHandler<TInput, TResult> = {
  bivariance_handler(input: TInput, options: RuntimeToolExecutionOptions): TResult;
}["bivariance_handler"];

/** 单次工具执行获得的稳定运行上下文。 */
export interface RuntimeToolExecutionOptions {
  /** 当前模型工具调用的稳定唯一标识。 */
  tool_call_id: string;
  /** 当前模型 step 使用的完整消息快照。 */
  messages: ModelMessage[];
  /** 当前 Turn 的可选取消信号。 */
  abort_signal?: AbortSignal;
  /** 宿主为本次执行注入的显式领域上下文。 */
  context?: unknown;
}

/** Downcity 进程内可执行工具定义。 */
export interface RuntimeTool<TInput = unknown, TOutput = unknown> {
  /** 面向模型的工具用途说明。 */
  description?: string;
  /** JSON Schema 或可转换为 JSON Schema 的输入定义。 */
  input_schema: unknown;
  /** 可选工具执行实现；缺少时该工具只向模型声明能力。 */
  execute?: RuntimeToolHandler<TInput, TOutput | Promise<TOutput>>;
}

/** 创建可执行工具并保留输入与输出类型推导。 */
export function define_runtime_tool<TInput = unknown, TOutput = unknown>(
  input: RuntimeTool<TInput, TOutput>,
): RuntimeTool<TInput, TOutput> {
  return input;
}
