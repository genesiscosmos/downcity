/**
 * Power 基类：身份、动作、hooks 与编译。
 *
 * 关键点（中文）
 * - Power 自己知道如何编译成模型侧工具与检查点处理器；Registry 只负责集合与查询。
 * - 工具闭包持有本实例与容器运行时端口，执行时不再回到 Registry 二次解析。
 * - 工具调用只负责协议适配：取动作、处理省略 action 的索引、包装统一 ActionResult。
 * - 一个 City 中每个 Power ID 只存在一个实例，由容器持有生命周期。
 * - 可执行部件声明为可选方法，子类既可用方法覆写，也可用属性赋值。
 */

import {
  define_agent_tool,
  type ActionResult,
  type AgentTool,
  type EffectHook,
  type GuardHook,
  type JsonObject,
  type JsonValue,
  type PipelineHook,
  type SessionSystemBlock,
  type ToolCallContext,
  type ToolHookSet,
} from "@downcity/type";
import { SESSION_HOOK_POINTS } from "@downcity/type";
import type { PowerRuntimeHost } from "./types/PowerCallSite.js";
import type {
  PowerActionReadView,
  PowerActions,
  PowerAvailability,
  PowerDefinition,
  PowerHooks,
  PowerHttpDefinition,
  PowerResolves,
} from "./types/PowerRuntime.js";
import type { PowerContext } from "./types/PowerContext.js";
import type { PowerLifecycleContext } from "./types/PowerHost.js";
import type { StepSnapshot } from "./types/StepSnapshot.js";
import type { PowerToolInput, PowerToolResult } from "./types/PowerTool.js";
import { power_tool_input_schema } from "./tool/PowerToolSchemas.js";
import { execute_power_action } from "./core/PowerActionExecution.js";

/** 取描述文本首行，用于工具描述中的动作摘要。 */
function first_line(text: string | undefined): string {
  return String(text || "").trim().split("\n")[0].trim();
}

/** 判断值是否为普通 JSON 对象。 */
function to_json_object(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/** 构造一次工具调用的失败结果。 */
function failure_result(
  power_name: string,
  action: string | null,
  message: string,
): ActionResult<PowerToolResult> {
  return {
    output: { success: false, power: power_name, action, message, error: message },
    messages: [],
  };
}

/**
 * City 持有的 Power 基类。
 *
 * 关键点（中文）：子类只需声明身份、动作与 hooks；编译与调用适配由基类完成。
 */
export abstract class Power implements PowerDefinition {
  /** Power 稳定 ID，同时是模型侧工具名。 */
  abstract readonly name: string;

  /** Power 用户可见标题。 */
  readonly title: string = "";

  /** Power 用途说明。 */
  readonly description: string = "";

  /** Power Action 集合。 */
  readonly actions: PowerActions = {};

  /** Power 原始 Hook 声明；由基类编译为检查点处理器。 */
  readonly hooks?: PowerHooks;

  /** Power Resolve 点集合。 */
  readonly resolves?: PowerResolves;

  /** Power 的可选 HTTP 路由声明。 */
  readonly http?: PowerHttpDefinition;

  /** 构建当前执行范围的 system 文本。 */
  system?(context: PowerContext, snapshot: StepSnapshot): string | Promise<string>;

  /** Power 加入 City 时初始化自身长期资源。 */
  initialize?(context: PowerLifecycleContext): void | Promise<void>;

  /** Power 离开 City 时释放自身长期资源。 */
  dispose?(context: PowerLifecycleContext): void | Promise<void>;

  /** 检查当前上下文的可用性。 */
  availability?(context: PowerContext): PowerAvailability | Promise<PowerAvailability>;

  /** 编译为模型侧工具；没有动作时返回 null，不产生空壳工具。 */
  compile_tool(host: PowerRuntimeHost): AgentTool | null {
    const power_name = String(this.name || "").trim();
    if (!power_name) return null;
    if (Object.keys(this.actions || {}).length === 0) return null;
    return define_agent_tool<PowerToolInput>({
      description: this.describe_tool(),
      input_schema: power_tool_input_schema,
      execute: async (input: PowerToolInput, call_context: ToolCallContext) =>
        await this.invoke_tool(host, call_context, input),
    });
  }

  /** 编译为按检查点索引的处理器集合。 */
  compile_hooks(host: PowerRuntimeHost): ToolHookSet {
    const power_name = String(this.name || "").trim();
    const pipeline: Record<string, readonly PipelineHook[]> = {};
    const guard: Record<string, readonly GuardHook[]> = {};
    const effect: Record<string, readonly EffectHook[]> = {};
    if (!power_name) return Object.freeze({ pipeline, guard, effect });

    // system() 并入 system_context 检查点：Power 只有一个位置写 system 内容，
    // 不再需要判断「静态说明写 system() 还是 pipeline」。
    if (typeof this.system === "function") {
      pipeline[SESSION_HOOK_POINTS.system_context] = [this.create_system_handler(host)];
    }

    for (const [point_name, handlers] of Object.entries(this.hooks?.pipeline ?? {})) {
      const compiled = handlers.map((handler): PipelineHook =>
        async (value, call_context: ToolCallContext) =>
          await handler({
            context: host.context_for(power_name, call_context),
            value,
            power: power_name,
          }));
      pipeline[point_name] = [...(pipeline[point_name] ?? []), ...compiled];
    }

    for (const [point_name, handlers] of Object.entries(this.hooks?.guard ?? {})) {
      const compiled = handlers.map((handler): GuardHook =>
        async (value, call_context: ToolCallContext) => {
          await handler({
            context: host.context_for(power_name, call_context),
            value,
            power: power_name,
          });
        });
      guard[point_name] = [...(guard[point_name] ?? []), ...compiled];
    }

    for (const [point_name, handlers] of Object.entries(this.hooks?.effect ?? {})) {
      const compiled = handlers.map((handler): EffectHook =>
        async (value, call_context: ToolCallContext) => {
          await handler({
            context: host.context_for(power_name, call_context),
            value,
            power: power_name,
          });
        });
      effect[point_name] = [...(effect[point_name] ?? []), ...compiled];
    }

    return Object.freeze({
      pipeline: Object.freeze(pipeline),
      guard: Object.freeze(guard),
      effect: Object.freeze(effect),
    });
  }

  /**
   * 派生模型侧工具描述。
   *
   * 关键点（中文）：只列动作 id 与一行摘要，参数 schema 留给省略 action 的
   * 索引响应，避免每个动作的完整 schema 常驻工具描述。
   */
  private describe_tool(): string {
    const title = String(this.title || this.name || "").trim();
    const description = String(this.description || "").trim();
    const actions = Object.entries(this.actions || {}).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const header = description || title || `Power "${this.name}".`;
    if (actions.length === 0) return header;
    return [
      header,
      "",
      "Actions (omit \"action\" to list them with their input schema):",
      ...actions.map(([action_id, action]) => `- ${action_id}: ${first_line(action.description)}`),
    ].join("\n");
  }

  /** 把 `system()` 编译为 system_context 处理器。 */
  private create_system_handler(host: PowerRuntimeHost): PipelineHook {
    const power_name = String(this.name || "").trim();
    return async (value, call_context: ToolCallContext) => {
      const context = host.context_for(power_name, call_context);
      if (typeof this.availability === "function") {
        const availability = await this.availability(context);
        if (!availability.available) return value;
      }
      const text = String(
        await this.system?.(context, context.snapshot) ?? "",
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
  }

  /**
   * 执行一次工具调用。
   *
   * 关键点（中文）
   * - 省略 action 时返回动作索引，成功语义与索引调用一致。
   * - 环境组装交给容器运行时端口；本方法只做协议适配。
   * - 失败永远返回结果而不是抛错，保证模型能看到可读边界说明。
   */
  private async invoke_tool(
    host: PowerRuntimeHost,
    call_context: ToolCallContext,
    input: PowerToolInput,
  ): Promise<ActionResult<PowerToolResult>> {
    const power_name = String(this.name || "").trim();
    const action_id = typeof input?.action === "string" ? input.action.trim() : "";
    const args = to_json_object(input?.args ?? {}) ?? {};

    if (!action_id) {
      return {
        output: {
          success: true,
          power: power_name,
          action: null,
          message: `${Object.keys(this.actions || {}).length} action(s) available on power "${power_name}"`,
          data: this.build_index_data(),
        },
        messages: [],
      };
    }

    const action = this.actions?.[action_id];
    if (!action) {
      return failure_result(
        power_name,
        action_id,
        `Power "${power_name}" does not implement action "${action_id}"`,
      );
    }

    try {
      const result = await execute_power_action({
        host,
        power_name,
        action_name: action_id,
        action,
        payload: args as JsonValue,
        site: call_context,
      });
      return {
        output: {
          success: result.success,
          power: power_name,
          action: action_id,
          message:
            String(result.message || result.error || "").trim() ||
            (result.success ? "power action completed" : "power action failed"),
          ...(result.error ? { error: result.error } : {}),
          ...(result.data === undefined
            ? {}
            : {
                data: to_json_object(result.data) || {
                  kind: "json",
                  value: result.data as JsonValue,
                },
              }),
        },
        messages: result.messages || [],
      };
    } catch (error) {
      return failure_result(power_name, action_id, String(error));
    }
  }

  /** 构造省略 action 时返回的动作索引。 */
  private build_index_data(): JsonObject {
    const actions = Object.entries(this.actions || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([action_id, action]) => to_action_summary(action_id, action));
    return {
      power: this.name,
      title: String(this.title || this.name || "").trim(),
      description: String(this.description || "").trim(),
      actions: actions.map((action) => ({
        action: action.name,
        description: action.description,
        access: action.access,
        returns: action.returns,
        has_input_schema: action.has_input_schema,
      })),
    };
  }
}

/** 把一个 action 定义投影为索引条目。 */
function to_action_summary(
  action_id: string,
  action: NonNullable<PowerActions>[string],
): PowerActionReadView {
  return {
    name: action_id,
    description: String(action.description || "").trim(),
    access: action.access === "write" ? "write" : "read",
    returns: String(action.returns || "").trim(),
    has_input_schema: Boolean(action.input_schema),
    ...(action.input_schema?.json_schema
      ? { input_schema: action.input_schema.json_schema }
      : {}),
    ...(action.examples ? { examples: action.examples } : {}),
    has_command: Boolean(action.command),
    has_api: Boolean(action.api),
  };
}
