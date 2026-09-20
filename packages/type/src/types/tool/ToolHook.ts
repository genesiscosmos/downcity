/**
 * 扩展能力内容贡献协议。
 *
 * Power 编译后向 Agent 提供三类处理器；它们都是普通函数，Agent 直接调用并注入
 * 调用环境。City 不在调用路径上，处理器闭包内已绑定目标 Power 与上下文工厂。
 *
 * 关键点（中文）
 * - 三类处理器语义不同：pipeline 变换值，guard 校验后中断，effect 只产生副作用。
 * - 处理器按注册顺序串行执行；顺序由编译时的 Power 顺序决定。
 * - 检查点值统一以 JSON 表达，具体形状由检查点常量与消费方共同约定。
 */

import type { JsonValue } from "../json/Json.js";
import type { ToolCallContext } from "../session/ToolCallContext.js";

/** 变换处理器：接收当前值，返回变换后的值。 */
export type PipelineHook<TValue = JsonValue> = (
  value: TValue,
  context: ToolCallContext,
) => Promise<TValue>;

/** 校验处理器：抛错即中断当前检查点。 */
export type GuardHook<TValue = JsonValue> = (
  value: TValue,
  context: ToolCallContext,
) => Promise<void>;

/** 副作用处理器：不返回值，失败不影响主链路。 */
export type EffectHook<TValue = JsonValue> = (
  value: TValue,
  context: ToolCallContext,
) => Promise<void>;

/** 按检查点名索引的扩展处理器集合。 */
export interface ToolHookSet {
  /** 变换点；键为检查点名。 */
  readonly pipeline: Readonly<Record<string, readonly PipelineHook[]>>;
  /** 校验点；键为检查点名。 */
  readonly guard: Readonly<Record<string, readonly GuardHook[]>>;
  /** 副作用点；键为检查点名。 */
  readonly effect: Readonly<Record<string, readonly EffectHook[]>>;
}

/** 一个不含任何处理器的空处理器集合。 */
export const EMPTY_TOOL_HOOK_SET: ToolHookSet = Object.freeze({
  pipeline: Object.freeze({}),
  guard: Object.freeze({}),
  effect: Object.freeze({}),
});
