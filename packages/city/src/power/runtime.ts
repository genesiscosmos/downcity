/**
 * Power Action 类型辅助。
 *
 * 这些函数只保留输入的精确类型，不创建隐藏容器或额外生命周期。
 * Power 基类在 `./Power.js`。
 */

import type { z } from "zod";
import type { PowerJsonValue } from "./types/Json.js";
import type {
  PowerAction,
  PowerActionInputSchema,
  PowerActionResult,
} from "./types/PowerRuntime.js";

/** 从 Zod schema 推导 JSON 输入。 */
type InferZodJson<TSchema extends z.ZodTypeAny> = z.infer<TSchema> extends PowerJsonValue
  ? z.infer<TSchema>
  : PowerJsonValue;

/** 创建 Action 时接受的完整定义。 */
export type CreatePowerActionOptions<TInput extends PowerJsonValue, TResult extends PowerJsonValue> =
  Omit<PowerAction<TInput, TResult>, "input_schema"> & {
    /** Zod schema 或完整 schema 定义。 */
    readonly input_schema?: z.ZodTypeAny | PowerActionInputSchema<TInput>;
  };

/** 归一化 Action 输入 schema。 */
function normalize_input_schema<TInput extends PowerJsonValue>(
  input_schema: z.ZodTypeAny | PowerActionInputSchema<TInput> | undefined,
): PowerActionInputSchema<TInput> | undefined {
  if (!input_schema) return undefined;
  if (typeof (input_schema as z.ZodTypeAny).safeParse === "function") {
    return { zod: input_schema as z.ZodTypeAny };
  }
  return input_schema as PowerActionInputSchema<TInput>;
}

/** 创建带类型推导的 Power Action。 */
export function create_action<TSchema extends z.ZodTypeAny, TResult extends PowerJsonValue = PowerJsonValue>(
  options: CreatePowerActionOptions<InferZodJson<TSchema>, TResult> & {
    /** 用于推导 payload 的 Zod schema。 */
    readonly input_schema?: TSchema | PowerActionInputSchema<InferZodJson<TSchema>>;
  },
): PowerAction<InferZodJson<TSchema>, TResult>;

/** 创建不依赖 Zod 推导的 Power Action。 */
export function create_action<TResult extends PowerJsonValue = PowerJsonValue>(
  options: CreatePowerActionOptions<PowerJsonValue, TResult>,
): PowerAction<PowerJsonValue, TResult>;

export function create_action(
  options: CreatePowerActionOptions<PowerJsonValue, PowerJsonValue>,
): PowerAction<PowerJsonValue, PowerJsonValue> {
  const { input_schema, ...definition } = options;
  return {
    ...definition,
    ...(input_schema ? { input_schema: normalize_input_schema(input_schema) } : {}),
  };
}

/** Action 执行器常用返回类型别名。 */
export type AnyPowerActionResult = PowerActionResult<PowerJsonValue>;
