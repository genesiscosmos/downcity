/**
 * Agent 本地实例配置与生命周期类型。
 *
 * 关键点（中文）
 * - 只描述本地 Agent 的构造、启动、停止与 RPC 绑定。
 * - RemoteAgent 与 Session 数据结构拆到独立类型文件。
 */

import type { ModelClient, AgentTool as Tool, ToolHookSet } from "@downcity/type";
import type {
  AgentManagedSession,
  SessionOptions,
} from "@/types/session/SessionOptions.js";
import type { SessionComposer } from "@/types/session/SessionComposer.js";

/**
 * Agent 可使用的 Session 类。
 *
 * 关键点（中文）
 * - 传 class，而不是传实例，保证 Agent 可以按 session_id 创建多个 session。
 * - 自定义类可继承默认 `Session`，并在构造函数里注入自己的 Composer。
 */
export type AgentSessionConstructor = new (
  options: SessionOptions,
) => AgentManagedSession;

/**
 * 本地 Agent 构造参数。
 */
export interface AgentOptions {
  /**
   * 当前 agent 的稳定标识。
   *
   * 关键点（中文）
   * - 用于用户级数据根下的 `agents/<agent_id>/...` 目录分区。
   * - 应保持稳定、可 URL 编码、尽量不要依赖展示名称。
   */
  id: string;

  /**
   * 当前 Agent 的用户可见名称。
   *
   * 省略或传入空字符串时使用 `id`；Group 调度会使用该名称理解成员身份。
   */
  name?: string;

  /**
   * 当前 Agent 的一句话能力描述。
   *
   * 该字段用于展示和 Group 语义调度，不替代决定 Agent 行为的 `instruction`。
   */
  description?: string;

  /**
   * 当前 agent 自有的工具集合。
   *
   * 关键点（中文）
   * - tools 归属于 agent 级，而不是 session 级。
   * - 与 Workspace 工具、容器 Power 工具在 Session 创建时合并；同名冲突立即失败。
   */
  tools?: Record<string, Tool>;

  /**
   * 当前 agent 自有的检查点处理器集合。
   *
   * 关键点（中文）
   * - 与容器提供的 Power hooks 合并；同名检查点按「容器在前、自有在后」顺序执行。
   * - 不传入时只使用容器提供的 hooks。
   */
  hooks?: ToolHookSet;

  /**
   * 调用方显式传入的静态基础指令。
   *
   * 关键点（中文）
   * - `instruction` 是稳定、缓存友好的 system 前缀，不做动态变量替换。
   * - 项目目录不再提供隐式 prompt 文件；调用方需要的指令必须显式传入。
   * - 未传入时，SDK 会使用包内最小 core instruction 作为 fallback。
   */
  instruction?: string | string[];

  /**
   * 当前 Agent 持有的运行时模型实例。
   *
   * 关键点（中文）
   * - Agent 不选择或恢复模型，只持有宿主传入的实例。
   * - Session 未显式设置模型时，执行自动回退到该实例。
   */
  model?: ModelClient;

  /**
   * 当前 agent 使用的本地 Session 类。
   *
   * 关键点（中文）
   * - Agent 只负责用这个类创建/恢复 session，不感知具体 Composer 策略。
   * - 如果需要自定义 Composer，请在自定义 Session 类内部传给 `super({ composer })`。
   * - 该能力仅适用于本地 `Agent`。
   */
  session_class?: AgentSessionConstructor;

  /**
   * 当前 Agent 使用的 Session Composer。
   *
   * 关键点（中文）
   * - Composer 描述「这个 Agent 怎么和模型说话」，属于 Agent 级特性，被其所有 Session 共享。
   * - 实现必须无状态：全部 Session 与上下文都由 `compose(input)` 参数传入，派生数据写入传入的 `derived` 存储。
   * - 省略时使用默认 `DefaultSessionComposer`。
   */
  session_composer?: SessionComposer;

}
