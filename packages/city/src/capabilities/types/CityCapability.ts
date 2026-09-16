/**
 * City Capability 契约。
 *
 * 关键点（中文）
 * - Capability 是 City 自己拥有的能力：不连接外部系统，没有账号与凭据，
 *   能力来源是 City 持有的 Embassy、当前 Workspace 与 Session。
 * - 与 Plugin 的唯一区别是模型入口：Capability 暴露**一等工具**（工具名直接可见），
 *   Plugin 只能通过 `plugin_call` / `plugin_read` 被调用。
 * - Capability 的说明文本统一由 City 注入 session system，一个来源，一处维护。
 * - 需要第三方安装、外部连接、设置页或 plugin↔plugin hook 的能力仍属于 Plugin。
 */

import type { ActionResult } from "@downcity/agent";
import type { Embassy } from "@downcity/federation";
import type { FileSystem } from "@/workspace/index.js";

/** Capability 工具的单次执行上下文。 */
export interface CityCapabilityContext {
  /** 当前 capability 稳定标识，例如 image。 */
  readonly capability_id: string;
  /** 当前 Agent 稳定标识。 */
  readonly agent_id: string;
  /** 当前 Workspace 的宿主绝对路径；本地相对路径以此为根。 */
  readonly workspace_path: string;
  /** 当前 capability 在当前 Agent 范围内的私有文件端口。 */
  readonly files: FileSystem;
  /** City 的 Federation Embassy；未配置时为空。 */
  readonly embassy?: Embassy;
  /** 当前 Session 标识；非 Session 调用时为空。 */
  readonly session_id: string | null;
  /** 当前 Turn 标识；非 Session 调用时为空。 */
  readonly turn_id: string | null;
  /** 当前 Turn 的取消信号。 */
  readonly abort_signal?: AbortSignal;
}

/** Capability 暴露给模型的一个一等工具。 */
export interface CityCapabilityTool {
  /** 模型可见的工具名，snaker，需要全局唯一。 */
  readonly name: string;
  /** 面向模型的工具说明。 */
  readonly description: string;
  /** JSON Schema 输入定义。 */
  readonly input_schema: unknown;
  /** 执行工具，返回统一 ActionResult。 */
  execute(
    input: unknown,
    context: CityCapabilityContext,
  ): Promise<ActionResult>;
}

/** City 自己拥有的一个能力。 */
export interface CityCapability {
  /** capability 稳定标识，snaker。 */
  readonly id: string;
  /** 暴露给模型的一等工具集合。 */
  readonly tools: readonly CityCapabilityTool[];
  /** 需要注入 session system 的说明文本；没有时省略。 */
  system?(context: CityCapabilityContext): string | Promise<string>;
  /**
   * 供其他插件或宿主调用的程序化入口，不进入模型工具清单。
   *
   * 关键点（中文）
   * - 用于「能力归 City、触发归插件」的场景，例如 chat 入站自动转写。
   * - 与 tool 共享同一套执行上下文与错误语义：失败直接抛错。
   */
  invoke?(
    /** 程序化动作名，snaker。 */
    action: string,
    /** 动作输入。 */
    input: unknown,
    /** 当前执行上下文。 */
    context: CityCapabilityContext,
  ): Promise<unknown>;
}
