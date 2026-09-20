/**
 * Session 检查点执行器。
 *
 * 扩展能力编译后提供三类普通函数；本模块负责按检查点取出处理器、串行执行，
 * 并把失败隔离到单个检查点。Agent 内部只有这一个地方调用扩展处理器。
 *
 * 关键点（中文）
 * - pipeline 变换值，guard 抛错即中断，effect 只产生副作用。
 * - 没有处理器时返回原值，调用方不需要判断检查点是否存在。
 * - 处理器失败不向上抛出：内容贡献是增强，不应阻断 Session 主链路。
 */

import type {
  EffectHook,
  GuardHook,
  JsonValue,
  PipelineHook,
  ToolCallContext,
  ToolHookSet,
} from "@downcity/type";

/** 单个检查点执行失败时的观察入口。 */
export type HookFailureObserver = (
  point_name: string,
  error: unknown,
) => Promise<void>;

/** 运行一个 pipeline 检查点；处理器按顺序链式变换值。 */
export async function run_pipeline_point<TValue extends JsonValue>(input: {
  /** 当前生效的处理器集合。 */
  readonly hooks: ToolHookSet;
  /** 目标检查点名。 */
  readonly point_name: string;
  /** 当前值。 */
  readonly value: TValue;
  /** 当前调用环境。 */
  readonly context: ToolCallContext;
  /** 失败观察入口。 */
  readonly on_error?: HookFailureObserver;
}): Promise<TValue> {
  const handlers = input.hooks.pipeline[input.point_name] as unknown as
    | readonly PipelineHook<TValue>[]
    | undefined;
  if (!handlers || handlers.length === 0) return input.value;
  let current = input.value;
  for (const handler of handlers) {
    try {
      current = await handler(current, input.context);
    } catch (error) {
      await input.on_error?.(input.point_name, error);
    }
  }
  return current;
}

/** 运行一个 guard 检查点；任一处理器抛错即中断。 */
export async function run_guard_point(input: {
  /** 当前生效的处理器集合。 */
  readonly hooks: ToolHookSet;
  /** 目标检查点名。 */
  readonly point_name: string;
  /** 当前值。 */
  readonly value: JsonValue;
  /** 当前调用环境。 */
  readonly context: ToolCallContext;
}): Promise<void> {
  const handlers = input.hooks.guard[input.point_name] as unknown as
    | readonly GuardHook[]
    | undefined;
  if (!handlers || handlers.length === 0) return;
  for (const handler of handlers) {
    await handler(input.value, input.context);
  }
}

/** 运行一个 effect 检查点；失败被隔离，不影响后续处理器与主链路。 */
export async function run_effect_point(input: {
  /** 当前生效的处理器集合。 */
  readonly hooks: ToolHookSet;
  /** 目标检查点名。 */
  readonly point_name: string;
  /** 当前值。 */
  readonly value: JsonValue;
  /** 当前调用环境。 */
  readonly context: ToolCallContext;
  /** 失败观察入口。 */
  readonly on_error?: HookFailureObserver;
}): Promise<void> {
  const handlers = input.hooks.effect[input.point_name] as unknown as
    | readonly EffectHook[]
    | undefined;
  if (!handlers || handlers.length === 0) return;
  for (const handler of handlers) {
    try {
      await handler(input.value, input.context);
    } catch (error) {
      await input.on_error?.(input.point_name, error);
    }
  }
}
