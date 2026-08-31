/**
 * Downcity 模型工具协议模块。
 *
 * 工具协议只携带模型可见定义，运行时 execute 函数始终由 Agent 工具注册表拥有。
 */

import type { ModelJsonValue } from "./ModelJson.js";

/** 单个模型可调用工具的公开定义。 */
export interface ModelTool {
  /** 本次调用内唯一的工具名称。 */
  name: string;
  /** 面向模型的工具用途说明。 */
  description: string;
  /** 工具输入 JSON Schema。 */
  input_schema: { [key: string]: ModelJsonValue };
}

/** 本轮模型调用的工具选择策略。 */
export type ModelToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "tool"; tool_name: string };
