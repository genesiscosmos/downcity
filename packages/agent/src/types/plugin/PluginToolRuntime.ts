/**
 * Plugin tool runtime 绑定类型。
 *
 * 关键点（中文）
 * - plugin_call / plugin_read 必须绑定当前 Agent 自己的 plugin registry。
 * - 这些类型描述 tool 工厂与 bridge 调用时需要的显式 runtime 依赖。
 */

import type { Tool } from "ai";
import type { AgentPlugins } from "@/types/plugin/PluginRuntime.js";
import type {
  PluginCallInput,
  PluginReadInput,
} from "@/executor/tools/plugin/types/PluginTool.js";
import type { SessionTurnContext } from "@/types/executor/SessionTurnContext.js";

/**
 * 创建 plugin tools 的参数。
 */
export interface CreatePluginToolsOptions {
  /**
   * 当前 Agent 自己的 plugin 调用面。
   *
   * 关键点（中文）
   * - 该引用必须来自当前 Agent 装配出的 plugin registry。
   * - tool 执行时只能通过它访问 plugin，避免跨 Agent 读到其他 registry。
   */
  plugins: AgentPlugins;
}

/**
 * 当前 Agent 专属 plugin tools。
 */
export interface AgentPluginTools {
  /**
   * 读取 plugin metadata 的模型工具。
   *
   * 关键点（中文）
   * - 该 tool 通过闭包绑定当前 Agent 的 `plugins`。
   * - 不读取任何模块级全局 runtime。
   */
  plugin_read: Tool;

  /**
   * 执行 plugin action 的模型工具。
   *
   * 关键点（中文）
   * - 该 tool 通过闭包绑定当前 Agent 的 `plugins`。
   * - 多 Agent 并发时，每个 Agent 都有自己的 tool 实例。
   */
  plugin_call: Tool;
}

/**
 * 调用 plugin_call bridge 的参数。
 */
export interface InvokePluginCallToolOptions {
  /**
   * 当前 Agent 自己的 plugin 调用面。
   *
   * 关键点（中文）
   * - 由 Agent 级 tool 工厂注入。
   * - 不能在 bridge 内通过全局变量读取。
   */
  plugins: AgentPlugins;

  /**
   * 当前 Tool 调用所属的 Session Turn Context。
   *
   * 关键点（中文）
   * - 由 Executor 在每个 step 显式绑定。
   * - 用于选择当前 plugin lease、资源目录与 assistant file 队列。
   */
  turn_context: SessionTurnContext;

  /**
   * 模型提交给 plugin_call 的结构化输入。
   */
  input: PluginCallInput;
}

/**
 * 调用 plugin_read bridge 的参数。
 */
export interface InvokePluginReadToolOptions {
  /**
   * 当前 Agent 自己的 plugin 调用面。
   */
  plugins: AgentPlugins;

  /** 当前 Tool 调用所属的 Session Turn Context。 */
  turn_context: SessionTurnContext;

  /**
   * 模型提交给 plugin_read 的结构化输入。
   */
  input: PluginReadInput;
}
