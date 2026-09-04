/**
 * City Plugin 执行模块的轻量创建辅助函数。
 *
 * 这些函数只保留输入的精确类型，不创建隐藏容器或额外生命周期。
 */

import type { z } from "zod";
import type { PluginJsonValue } from "./types/Json.js";
import type {
  CityPluginModule,
  Plugin,
  PluginAction,
  PluginActionInputSchema,
  PluginActionResult,
  PluginActions,
} from "./types/PluginRuntime.js";

/** 从 Zod schema 推导 JSON 输入。 */
type InferZodJson<TSchema extends z.ZodTypeAny> = z.infer<TSchema> extends PluginJsonValue
  ? z.infer<TSchema>
  : PluginJsonValue;

/** 创建 Action 时接受的完整定义。 */
export type CreatePluginActionOptions<TInput extends PluginJsonValue, TResult extends PluginJsonValue> =
  Omit<PluginAction<TInput, TResult>, "input_schema"> & {
    /** Zod schema 或完整 schema 定义。 */
    readonly input_schema?: z.ZodTypeAny | PluginActionInputSchema<TInput>;
  };

/** 创建 Plugin 执行模块时接受的完整定义。 */
export type CreatePluginOptions<TActions extends PluginActions> = Omit<Plugin, "actions"> & {
  /** 保留具体 Action key 和输入类型的 Action 集合。 */
  readonly actions?: TActions;
};

/** 归一化 Action 输入 schema。 */
function normalize_input_schema<TInput extends PluginJsonValue>(
  input_schema: z.ZodTypeAny | PluginActionInputSchema<TInput> | undefined,
): PluginActionInputSchema<TInput> | undefined {
  if (!input_schema) return undefined;
  if (typeof (input_schema as z.ZodTypeAny).safeParse === "function") {
    return { zod: input_schema as z.ZodTypeAny };
  }
  return input_schema as PluginActionInputSchema<TInput>;
}

/** 创建带类型推导的 Plugin Action。 */
export function create_action<TSchema extends z.ZodTypeAny, TResult extends PluginJsonValue = PluginJsonValue>(
  options: CreatePluginActionOptions<InferZodJson<TSchema>, TResult> & {
    /** 用于推导 payload 的 Zod schema。 */
    readonly input_schema?: TSchema | PluginActionInputSchema<InferZodJson<TSchema>>;
  },
): PluginAction<InferZodJson<TSchema>, TResult>;

/** 创建不依赖 Zod 推导的 Plugin Action。 */
export function create_action<TResult extends PluginJsonValue = PluginJsonValue>(
  options: CreatePluginActionOptions<PluginJsonValue, TResult>,
): PluginAction<PluginJsonValue, TResult>;

export function create_action(
  options: CreatePluginActionOptions<PluginJsonValue, PluginJsonValue>,
): PluginAction<PluginJsonValue, PluginJsonValue> {
  const { input_schema, ...definition } = options;
  return {
    ...definition,
    ...(input_schema ? { input_schema: normalize_input_schema(input_schema) } : {}),
  };
}

/** 保留 Plugin 执行模块的精确 Action 类型。 */
export function create_plugin<TActions extends PluginActions>(
  plugin: CreatePluginOptions<TActions>,
): Plugin & { readonly actions: TActions } {
  const name = String(plugin.name || "").trim();
  if (!name) throw new Error("create_plugin requires a non-empty name");
  return {
    ...plugin,
    name,
    title: String(plugin.title || name).trim(),
    description: String(plugin.description || "").trim(),
    actions: plugin.actions ?? ({} as TActions),
  };
}

/** 保留统一 City Plugin 入口模块的精确类型。 */
export function define_city_plugin(module: CityPluginModule): CityPluginModule {
  return module;
}

/** BasePlugin：需要 class 状态时使用的最小执行模块基类。 */
export abstract class BasePlugin implements Plugin {
  /** Plugin 稳定 ID。 */
  abstract readonly name: string;
  /** Plugin 用户可见标题。 */
  readonly title: string = "";
  /** Plugin 用途说明。 */
  readonly description: string = "";
  /** Plugin Action。 */
  readonly actions: PluginActions = {};
  /** 由 City 持有的 Plugin 生命周期。 */
  lifecycle?: Plugin["lifecycle"];
}

/** Action 执行器常用返回类型别名。 */
export type AnyPluginActionResult = PluginActionResult<PluginJsonValue>;
