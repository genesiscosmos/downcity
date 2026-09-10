/**
 * Agent 本地实例配置与生命周期类型。
 *
 * 关键点（中文）
 * - 只描述本地 Agent 的构造、启动、停止与 RPC 绑定。
 * - RemoteAgent 与 Session 数据结构拆到独立类型文件。
 */

import type { ModelClient, RuntimeTool as Tool } from "@downcity/type";
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
   * 当前 agent 默认可用的工具集合。
   *
   * 关键点（中文）
   * - tools 归属于 agent 级，而不是 session 级。
   * - session 运行时会直接复用这份工具集合。
   */
  tools?: Record<string, Tool>;

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
   * 为每个 Session 创建独立 Composer 的工厂。
   *
   * 关键点（中文）
   * - 每次创建、恢复或 fork Session 都会调用一次，禁止返回共享实例。
   * - 省略时创建默认 `DefaultSessionComposer`。
   * - Context Policy 应在工厂内部随 Composer 一起创建，避免跨 Session 共享派生状态。
   */
  session_composer?: () => SessionComposer;

}
