/**
 * Power Hook 编译。
 *
 * 把 Power 集合编译为按检查点索引的处理器集合。编译后每个处理器的签名是
 * `(value, call_context)`，Agent 直接调用并注入调用环境；City 不在调用路径上。
 *
 * 关键点（中文）
 * - 编译时烧入 power 身份与上下文工厂，因此执行时无需查找 Registry。
 * - 处理器顺序由编译时的 power 顺序决定，与注册顺序一致。
 */

import type {
  EffectHook,
  GuardHook,
  JsonValue,
  PipelineHook,
  SessionSystemBlock,
  ToolCallContext,
  ToolHookSet,
} from "@downcity/type";
import { SESSION_HOOK_POINTS } from "@downcity/agent";
import type { PowerContextFactory } from "@/power/types/PowerContextFactory.js";
import type {
  PowerDefinition,
  PowerExecutionContext,
} from "@/power/types/PowerRuntime.js";

/**
 * 把工具调用环境投影为插件可见的执行快照。
 *
 * 关键点（中文）：`power.system()` 的第二个参数是 City 的执行快照；
 * 它只暴露当前 Step 已提交的事实，不暴露 Session 对象本身。
 */
function to_execution_context(call_context: ToolCallContext): PowerExecutionContext {
  return Object.freeze({
    session_id: call_context.session_id,
    session_origin: call_context.session_origin,
    ...(call_context.turn_id ? { turn_id: call_context.turn_id } : {}),
    ...(call_context.workspace ? { project_root: call_context.workspace.path } : {}),
    ...(call_context.workspace_env
      ? { workspace_env: call_context.workspace_env }
      : {}),
    ...(call_context.agent_instructions?.length
      ? { agent_systems: call_context.agent_instructions }
      : {}),
    ...(call_context.abort_signal ? { abort_signal: call_context.abort_signal } : {}),
    ...(call_context.tool_call_id ? { call_id: call_context.tool_call_id } : {}),
  });
}

export function compile_power_hooks(input: {
  /** 当前生效的 Power 定义。 */
  readonly definitions: readonly PowerDefinition[];
  /** 把调用环境扩展为插件侧完整上下文。 */
  readonly context_factory: PowerContextFactory;
}): ToolHookSet {
  const pipeline: Record<string, readonly PipelineHook[]> = {};
  const guard: Record<string, readonly GuardHook[]> = {};
  const effect: Record<string, readonly EffectHook[]> = {};

  const append = <THandler>(
    target: Record<string, readonly THandler[]>,
    point_name: string,
    handler: THandler,
  ): void => {
    target[point_name] = [...(target[point_name] ?? []), handler];
  };

  for (const power of input.definitions) {
    const power_name = String(power.name || "").trim();
    if (!power_name) continue;

    // power.system() 并入 system_context 检查点：插件只有一个位置写 system 内容，
    // 不再需要判断「静态说明写 system() 还是 pipeline」。
    if (typeof power.system === "function") {
      const system_handler: PipelineHook = async (value, call_context: ToolCallContext) => {
        const context = input.context_factory(power_name, call_context);
        if (typeof power.availability === "function") {
          const availability = await power.availability(context);
          if (!availability.available) return value;
        }
        const text = String(
          await power.system?.(context, to_execution_context(call_context)) ?? "",
        ).trim();
        if (!text) return value;
        const current = value as { blocks?: SessionSystemBlock[] };
        return {
          ...(value as Record<string, unknown>),
          blocks: [
            ...(Array.isArray(current.blocks) ? current.blocks : []),
            { source: "power", name: power_name, content: text } satisfies SessionSystemBlock,
          ],
        } as unknown as JsonValue;
      };
      append(pipeline, SESSION_HOOK_POINTS.system_context, system_handler);
    }

    for (const [point_name, handlers] of Object.entries(power.hooks?.pipeline ?? {})) {
      for (const handler of handlers) {
        const compiled: PipelineHook = async (value, call_context: ToolCallContext) =>
          await handler({
            context: input.context_factory(power_name, call_context),
            value,
            power: power_name,
          });
        append(pipeline, point_name, compiled);
      }
    }

    for (const [point_name, handlers] of Object.entries(power.hooks?.guard ?? {})) {
      for (const handler of handlers) {
        const compiled: GuardHook = async (value, call_context: ToolCallContext) => {
          await handler({
            context: input.context_factory(power_name, call_context),
            value,
            power: power_name,
          });
        };
        append(guard, point_name, compiled);
      }
    }

    for (const [point_name, handlers] of Object.entries(power.hooks?.effect ?? {})) {
      for (const handler of handlers) {
        const compiled: EffectHook = async (value, call_context: ToolCallContext) => {
          await handler({
            context: input.context_factory(power_name, call_context),
            value,
            power: power_name,
          });
        };
        append(effect, point_name, compiled);
      }
    }
  }

  return Object.freeze({
    pipeline: Object.freeze(pipeline),
    guard: Object.freeze(guard),
    effect: Object.freeze(effect),
  });
}
