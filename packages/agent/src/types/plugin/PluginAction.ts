/**
 * Plugin action 类型。
 *
 * 关键点（中文）
 * - action 是 plugin 对外暴露的显式能力。
 * - CLI / HTTP 只是 action 的输入适配层，真正执行器统一走 `execute`。
 */

import type { Command } from "commander";
import type { Context as HonoContext } from "hono";
import type { z } from "zod";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginExecutionContext } from "@/types/plugin/PluginExecutionContext.js";
import type { JsonObject, JsonValue } from "@/types/common/Json.js";

/**
 * Plugin action 调用参数。
 */
export interface PluginActionInvokeParams {
  /** 目标 plugin 名称。 */
  plugin: string;
  /** 目标 action 名称。 */
  action: string;
  /** 调用 payload（可选）。 */
  payload?: JsonValue;
}

/**
 * Plugin action 调用结果。
 */
export interface PluginActionInvokeResult {
  /** 调用是否成功。 */
  success: boolean;
  /** 结构化返回数据（可选）。 */
  data?: JsonValue;
  /** 错误信息（可选）。 */
  error?: string;
}

/**
 * Plugin action 调用端口。
 */
export interface PluginActionInvokePort {
  /** 调用指定 plugin action。 */
  invoke(
    params: PluginActionInvokeParams,
  ): Promise<PluginActionInvokeResult>;
}

/**
 * Plugin Action 执行结果。
 */
export interface PluginActionResult<R extends JsonValue = JsonValue> {
  /** Action 是否成功。 */
  success: boolean;
  /** 返回数据（可选）。 */
  data?: R;
  /** 错误信息（可选）。 */
  error?: string;
  /** 人类可读消息（可选）。 */
  message?: string;
}

/**
 * Plugin Action 命令输入。
 */
export interface PluginActionCommandInput {
  /** 位置参数列表。 */
  args: string[];
  /** 选项参数对象。 */
  opts: Record<string, JsonValue>;
}

/**
 * Plugin Action CLI 定义。
 */
export interface PluginActionCommand<P extends JsonValue = JsonValue> {
  /** 命令说明。 */
  description: string;
  /** 额外 commander 配置（可选）。 */
  configure?: (command: Command) => void;
  /** 将 CLI 输入映射为 payload。 */
  map_input: (input: PluginActionCommandInput) => P | Promise<P>;
}

/**
 * Plugin Action HTTP 定义。
 */
export interface PluginActionApi<P extends JsonValue = JsonValue> {
  /** HTTP 方法。 */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** HTTP 路径。 */
  path?: string;
  /** 将 HTTP 输入映射为 payload（可选）。 */
  map_input?: (ctx: HonoContext) => P | Promise<P>;
}

/**
 * Plugin Action 示例。
 */
export interface PluginActionExample<P extends JsonValue = JsonValue> {
  /** 示例标题。 */
  title: string;
  /** 示例说明。 */
  description?: string;
  /** 示例 payload。 */
  payload: P;
}

/**
 * Plugin Action 输入 schema。
 *
 * 关键点（中文）
 * - 优先支持 Zod，运行时用 safeParse 做校验。
 * - `json_schema` 用于给模型或 UI 读取；没有时仍可依赖 description/examples。
 */
export interface PluginActionInputSchema<P extends JsonValue = JsonValue> {
  /** Zod schema，负责运行时校验与 TypeScript 推导。 */
  zod?: z.ZodTypeAny;
  /** 面向模型和 UI 的 JSON Schema 描述。 */
  json_schema?: JsonObject;
}

/**
 * Plugin Action 元数据。
 */
export interface PluginActionMetadata<P extends JsonValue = JsonValue> {
  /** Action 用途说明。 */
  description?: string;
  /** Action 输入 schema。 */
  input_schema?: PluginActionInputSchema<P>;
  /** Action 调用示例。 */
  examples?: PluginActionExample<P>[];
}

/**
 * Plugin Action 定义。
 */
export interface PluginAction<
  P extends JsonValue = JsonValue,
  R extends JsonValue = JsonValue,
> extends PluginActionMetadata<P> {
  /** CLI 定义（可选）。 */
  command?: PluginActionCommand<P>;
  /** HTTP 定义（可选）。 */
  api?: PluginActionApi<P>;
  /** Action 执行器。 */
  execute: (params: {
    /** 当前执行上下文。 */
    context: PluginContext;
    /**
     * 当前 action 所属 Session Turn 的只读 Plugin 执行快照。
     *
     * 关键点（中文）
     * - 模型 tool 调用时必定提供。
     * - CLI、HTTP 或定时任务等非 Session 入口可能不提供。
     */
    execution_context?: PluginExecutionContext;
    /** 已通过 schema 校验后的输入。 */
    input: P;
    /** 当前插件名称。 */
    plugin_name: string;
    /** 当前 Action 名称。 */
    action_name: string;
  }) => Promise<PluginActionResult<R>> | PluginActionResult<R>;
}

/**
 * Plugin Action 集合。
 */
export type PluginActions = {
  [action_name: string]: PluginAction<JsonValue, JsonValue>;
};
