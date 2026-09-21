/**
 * Power 工具类型定义。
 *
 * 关键点（中文）
 * - 每个 Power 对应一个模型工具，工具名即 power 名，因此不存在跨 power 的通用调用入口。
 * - 工具输入只有 `{ action, args }`；省略 action 返回该 power 的动作索引，
 *   因此不再需要单独的 metadata 读取工具。
 * - 工具闭包直接持有 Power 定义与上下文工厂，执行时不经过 Registry 二次解析。
 */

import type { AgentTool, ToolCallContext } from "@downcity/type";
import type { JsonObject } from "@downcity/type";
import type { PowerContextFactory } from "@/power/types/PowerContextFactory.js";
import type { PowerDefinition } from "@/power/types/PowerRuntime.js";

/** 单个 power 工具的输入。 */
export interface PowerToolInput {
  /** 目标动作 id；省略时返回该 power 的动作索引。 */
  action?: string;
  /** 动作参数。 */
  args?: JsonObject;
}

/** 动作索引中的一个动作条目。 */
export interface PowerToolActionSummary {
  /** 动作 id。 */
  action: string;
  /** 动作摘要。 */
  description: string;
  /** 读写性质；未声明的动作按 read 处理。 */
  access: "read" | "write";
  /** 返回结构说明。 */
  returns: string;
}

/** power 工具返回给模型的结果。 */
export interface PowerToolResult {
  /** 调用是否成功。 */
  success: boolean;
  /** 目标 power 名。 */
  power: string;
  /** 目标动作 id；索引调用为 null。 */
  action: string | null;
  /** 人类可读消息。 */
  message: string;
  /** 错误信息。 */
  error?: string;
  /** 成功数据；索引调用时是动作列表。 */
  data?: JsonObject;
}

/** 创建单个 power 工具的依赖。 */
export interface CreatePowerToolOptions {
  /** 目标 power 定义；工具名与描述都由它派生。 */
  power: PowerDefinition;
  /** 把调用环境扩展为插件侧完整上下文。 */
  context_factory: PowerContextFactory;
}

/** 执行一次 power 工具调用的依赖。 */
export interface InvokePowerToolOptions {
  /** 目标 power 定义。 */
  power: PowerDefinition;
  /** 把调用环境扩展为插件侧完整上下文。 */
  context_factory: PowerContextFactory;
  /** Agent 注入的工具调用环境。 */
  call_context: ToolCallContext;
  /** 模型提交的结构化输入。 */
  input: PowerToolInput;
}

/** 一组 power 工具；键为 power 名。 */
export type AgentPowerTools = Record<string, AgentTool>;
