/**
 * Agent 工具协议。
 *
 * AgentTool 是 Agent 可调用的唯一工具形态：Workspace 文件工具、Shell 工具、Power
 * 工具与 Agent 自定义工具都使用这份契约。执行环境由 Agent 在调用时注入，工具实现
 * 不读取任何隐式全局状态，也无法自行获取 Session 或 Workspace 对象。
 */

import type { ToolCallContext } from "../session/ToolCallContext.js";

/** 允许异构工具注册表保留每个工具自己的输入类型。 */
type AgentToolHandler<TInput, TResult> = {
  bivariance_handler(input: TInput, context: ToolCallContext): TResult;
}["bivariance_handler"];

/** Agent 可调用的工具定义。 */
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  /** 面向模型的工具用途说明。 */
  readonly description?: string;
  /** JSON Schema 或可转换为 JSON Schema 的输入定义。 */
  readonly input_schema: unknown;
  /** 可选工具执行实现；缺少时该工具只向模型声明能力。 */
  readonly execute?: AgentToolHandler<TInput, TOutput | Promise<TOutput>>;
}

/** 创建可执行工具并保留输入与输出类型推导。 */
export function define_agent_tool<TInput = unknown, TOutput = unknown>(
  input: AgentTool<TInput, TOutput>,
): AgentTool<TInput, TOutput> {
  return input;
}
