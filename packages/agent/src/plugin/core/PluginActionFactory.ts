/**
 * PluginActionFactory：创建带 metadata 和 schema 的 plugin/action。
 *
 * 关键点（中文）
 * - `create_action` 让 action 的运行时 schema 与 TypeScript 输入类型保持一致。
 * - `create_plugin` 只做轻量对象装配，不强制继承 BasePlugin。
 * - 旧的 class extends BasePlugin 写法仍可继续使用。
 */

import type { z } from "zod";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { JsonValue } from "@/types/common/Json.js";
import type {
  PluginAction,
  PluginActionApi,
  PluginActionCommand,
  PluginActionExample,
  PluginActionInputSchema,
  PluginActionResult,
  PluginActions,
} from "@/types/plugin/PluginAction.js";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type {
  PluginAvailability,
  PluginConfigDefinition,
  PluginHooks,
  PluginResolves,
} from "@/types/plugin/PluginRuntime.js";
import type {
  PluginCommandContext,
  PluginLifecycle,
} from "@/types/plugin/PluginCommand.js";
import type {
  PluginSetupDefinition,
  PluginUsageDefinition,
} from "@/types/plugin/PluginSetup.js";
import type { PluginHttpDefinition } from "@/types/plugin/PluginHttp.js";
import type { StructuredConfig } from "@/types/plugin/PluginConfig.js";
import type { PluginRunContext } from "@/types/plugin/PluginRunContext.js";

/**
 * 从 Zod schema 推导 JSON 输入类型。
 */
type InferZodJson<TSchema extends z.ZodTypeAny> =
  z.infer<TSchema> extends JsonValue ? z.infer<TSchema> : JsonValue;

/**
 * create_action 参数。
 */
export interface CreatePluginActionOptions<
  P extends JsonValue,
  R extends JsonValue,
> {
  /** Action 用途说明。 */
  description?: string;
  /** Zod 输入 schema。 */
  input_schema?: z.ZodTypeAny | PluginActionInputSchema<P>;
  /** Action 调用示例。 */
  examples?: PluginActionExample<P>[];
  /** CLI 定义。 */
  command?: PluginActionCommand<P>;
  /** HTTP 定义。 */
  api?: PluginActionApi<P>;
  /** Action 执行器。 */
  execute: (params: {
    /** 当前执行上下文。 */
    context: PluginContext;
    /** 当前 action 的显式 Session run 上下文。 */
    run_context?: PluginRunContext;
    /** 已通过 schema 校验后的输入。 */
    input: P;
    /** 当前插件名称。 */
    plugin_name: string;
    /** 当前 Action 名称。 */
    action_name: string;
  }) => Promise<PluginActionResult<R>> | PluginActionResult<R>;
}

/**
 * create_plugin 参数。
 */
export interface CreatePluginOptions<TActions extends PluginActions> {
  /** Plugin 稳定名称。 */
  name: string;
  /** Plugin 展示标题。 */
  title?: string;
  /** Plugin 用途说明。 */
  description?: string;
  /** Plugin 显式 action 集合。 */
  actions?: TActions;
  /** Plugin 配置定义。 */
  config?: PluginConfigDefinition<StructuredConfig>;
  /** Plugin setup 定义。 */
  setup?: PluginSetupDefinition;
  /** Plugin usage 定义。 */
  usage?: PluginUsageDefinition;
  /** Plugin hook 集合。 */
  hooks?: PluginHooks;
  /** Plugin resolve 集合。 */
  resolves?: PluginResolves;
  /** Plugin system 文本构建器。 */
  system?: (
    context: PluginContext,
    run_context?: PluginRunContext,
  ) => string | Promise<string>;
  /** Plugin 生命周期定义。 */
  lifecycle?: PluginLifecycle;
  /** Plugin 可用性检查。 */
  availability?: (
    context: PluginCommandContext | PluginContext,
  ) => Promise<PluginAvailability> | PluginAvailability;
  /** Plugin HTTP 注入定义。 */
  http?: PluginHttpDefinition;
}

/**
 * 归一化输入 schema。
 */
function normalize_input_schema<P extends JsonValue>(
  input_schema: z.ZodTypeAny | PluginActionInputSchema<P> | undefined,
): PluginActionInputSchema<P> | undefined {
  if (!input_schema) return undefined;
  if (typeof (input_schema as z.ZodTypeAny).safeParse === "function") {
    return { zod: input_schema as z.ZodTypeAny };
  }
  return input_schema as PluginActionInputSchema<P>;
}

/**
 * 创建带 metadata 的 action。
 */
export function create_action<
  TSchema extends z.ZodTypeAny,
  R extends JsonValue = JsonValue,
>(
  options: CreatePluginActionOptions<InferZodJson<TSchema>, R> & {
    /** Zod 输入 schema。 */
    input_schema?: TSchema | PluginActionInputSchema<InferZodJson<TSchema>>;
  },
): PluginAction<InferZodJson<TSchema>, R>;
export function create_action<R extends JsonValue = JsonValue>(
  options: CreatePluginActionOptions<JsonValue, R>,
): PluginAction<JsonValue, R>;
export function create_action(
  options: CreatePluginActionOptions<JsonValue, JsonValue>,
): PluginAction<JsonValue, JsonValue> {
  return {
    ...(options.description ? { description: options.description } : {}),
    ...(options.input_schema
      ? { input_schema: normalize_input_schema(options.input_schema) }
      : {}),
    ...(options.examples ? { examples: options.examples } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(options.api ? { api: options.api } : {}),
    execute: options.execute,
  };
}

/**
 * 创建 plugin 对象。
 */
export function create_plugin<TActions extends PluginActions>(
  options: CreatePluginOptions<TActions>,
): Plugin & { actions: TActions } {
  const name = String(options.name || "").trim();
  if (!name) {
    throw new Error("create_plugin requires a non-empty name");
  }
  return {
    name,
    title: String(options.title || name).trim(),
    description: String(options.description || "").trim(),
    actions: options.actions || ({} as TActions),
    ...(options.config ? { config: options.config } : {}),
    ...(options.setup ? { setup: options.setup } : {}),
    ...(options.usage ? { usage: options.usage } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.resolves ? { resolves: options.resolves } : {}),
    ...(options.system ? { system: options.system } : {}),
    ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}),
    ...(options.availability ? { availability: options.availability } : {}),
    ...(options.http ? { http: options.http } : {}),
  };
}
