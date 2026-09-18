/**
 * Power 工具类型定义。
 *
 * 关键点（中文）
 * - 每个 Power 对应一个模型工具，工具名即 power 名，因此不存在跨 power 的通用调用入口。
 * - 工具输入只有 `{ action, args }`；省略 action 返回该 power 的动作索引，
 *   因此不再需要单独的 metadata 读取工具。
 * - 工具层不理解具体 power 的业务字段，`args` 保持开放 JSON 对象。
 */

import type { RuntimeTool as Tool } from "@downcity/type";
import type { JsonObject, SessionTurnContext } from "@downcity/agent";
import type { AgentPowerRuntime } from "@/power/types/PowerExecutionRuntime.js";
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
  /** 当前 Agent 自己的 power 调用面。 */
  powers: AgentPowerRuntime;
}

/** 调用 power 工具运行时的显式依赖。 */
export interface InvokePowerToolOptions {
  /** 当前 Agent 自己的 Power 调用面。 */
  powers: AgentPowerRuntime;
  /** 当前工具对应的 power 名。 */
  power_name: string;
  /** Executor 为当前 Tool Call 绑定的 Session Turn Context。 */
  turn_context: SessionTurnContext;
  /** Downcity Model Protocol 为当前调用分配的稳定 Tool Call 标识。 */
  call_id: string;
  /** 模型提交的结构化输入。 */
  input: PowerToolInput;
}

/** 一组 power 工具；键为 power 名。 */
export type AgentPowerTools = Record<string, Tool>;
