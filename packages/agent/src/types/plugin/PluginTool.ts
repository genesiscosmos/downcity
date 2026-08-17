/**
 * Plugin tool 类型定义。
 *
 * 关键点（中文）
 * - 这里描述模型通过 plugin_call 提交的最低层调用协议。
 * - payload 保持 JSON 对象，避免 tool 层理解具体 plugin 的业务字段。
 */

import type { Tool } from "ai";
import type { JsonObject } from "@/types/common/Json.js";
import type { AgentPlugins } from "@/types/plugin/PluginRuntime.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";

/**
 * plugin_call 输入。
 */
export interface PluginCallInput {
  /** 目标 plugin 名称。 */
  plugin: string;
  /** 目标 action 名称。 */
  action: string;
  /** 传给 plugin action 的 JSON payload。 */
  payload?: JsonObject;
}

/**
 * plugin_read 输入。
 */
export interface PluginReadInput {
  /** 要读取的 plugin 名称；不传则列出 plugin 概览。 */
  plugin?: string;
  /** 要读取的 action 名称；仅在 plugin 存在时生效。 */
  action?: string;
}

/**
 * plugin_call 返回给模型的摘要结果。
 */
export interface PluginCallToolResult {
  /** 调用是否成功。 */
  success: boolean;
  /** 目标 plugin 名称。 */
  plugin: string;
  /** 目标 action 名称。 */
  action: string;
  /** 人类可读消息。 */
  message: string;
  /** 错误信息。 */
  error?: string;
  /** 返回给模型读取的短摘要数据。 */
  data?: JsonObject;
}

/**
 * plugin_read 返回给模型的 metadata。
 */
export interface PluginReadToolResult {
  /** 调用是否成功。 */
  success: boolean;
  /** 人类可读消息。 */
  message: string;
  /** 读取到的 metadata。 */
  data: JsonObject;
}

/** 创建当前 Agent 专属 Plugin Tools 的参数。 */
export interface CreatePluginToolsOptions {
  /** 当前 Agent 自己的 Plugin 调用面；Tool 只能访问该 Registry。 */
  plugins: AgentPlugins;
}

/** 当前 Agent 专属的 Plugin Tools。 */
export interface AgentPluginTools {
  /** 通过闭包绑定当前 Registry 的 Plugin metadata 读取 Tool。 */
  plugin_read: Tool;

  /** 通过闭包绑定当前 Registry 的 Plugin Action 执行 Tool。 */
  plugin_call: Tool;
}

/** 调用 plugin_call 运行时的显式依赖。 */
export interface InvokePluginCallToolOptions {
  /** 当前 Agent 自己的 Plugin 调用面。 */
  plugins: AgentPlugins;

  /** Executor 为当前 Tool Call 绑定的 Session Turn Context。 */
  turn_context: SessionTurnContext;

  /** AI SDK 为当前 plugin_call 分配的稳定 Tool Call 标识。 */
  call_id: string;

  /** 模型提交给 plugin_call 的结构化输入。 */
  input: PluginCallInput;
}

/** 调用 plugin_read 运行时的显式依赖。 */
export interface InvokePluginReadToolOptions {
  /** 当前 Agent 自己的 Plugin 调用面。 */
  plugins: AgentPlugins;

  /** Executor 为当前 Tool Call 绑定的 Session Turn Context。 */
  turn_context: SessionTurnContext;

  /** 模型提交给 plugin_read 的结构化输入。 */
  input: PluginReadInput;
}
