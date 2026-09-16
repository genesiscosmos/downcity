/**
 * city tool 动作参数取值与校验。
 *
 * 关键点（中文）
 * - 参数只在 provider 内按需取值，避免为开放 args 对象再维护一层 schema 转换。
 * - 取值失败统一抛出 invalid_args，并由 dispatcher 转为模型可读信封。
 */

import { CityToolRuntimeError } from "@/city/tool/CityToolErrors.js";

/** 拒绝当前动作收到未声明的参数，避免模型静默传错字段。 */
export function assert_known_args(input: {
  /** 当前动作收到的原始参数。 */
  args: Record<string, unknown>;
  /** 当前动作声明的参数名。 */
  allowed: readonly string[];
  /** 当前动作名，用于错误消息。 */
  action: string;
}): void {
  const unknown_names = Object.keys(input.args)
    .filter((name) => !input.allowed.includes(name));
  if (unknown_names.length === 0) return;
  throw new CityToolRuntimeError({
    code: "invalid_args",
    message:
      `Action "${input.action}" does not accept argument(s): ${unknown_names.join(", ")}. `
      + `Supported arguments: ${input.allowed.length > 0 ? input.allowed.join(", ") : "none"}.`,
  });
}

/** 读取必填字符串参数。 */
export function read_required_string_arg(input: {
  /** 当前动作收到的原始参数。 */
  args: Record<string, unknown>;
  /** 参数名。 */
  name: string;
  /** 当前动作名，用于错误消息。 */
  action: string;
}): string {
  const value = read_optional_string_arg(input);
  if (value !== null) return value;
  throw new CityToolRuntimeError({
    code: "invalid_args",
    message: `Action "${input.action}" requires a non-empty string argument: ${input.name}.`,
  });
}

/** 读取可选字符串参数；缺失或非法时返回 null。 */
export function read_optional_string_arg(input: {
  /** 当前动作收到的原始参数。 */
  args: Record<string, unknown>;
  /** 参数名。 */
  name: string;
}): string | null {
  const raw_value = input.args[input.name];
  if (raw_value === undefined || raw_value === null) return null;
  const value = typeof raw_value === "string" ? raw_value.trim() : "";
  return value || null;
}

/** 读取可选枚举参数；缺失时返回 null，非法值直接失败。 */
export function read_optional_enum_arg<TValue extends string>(input: {
  /** 当前动作收到的原始参数。 */
  args: Record<string, unknown>;
  /** 参数名。 */
  name: string;
  /** 允许的取值集合。 */
  allowed: readonly TValue[];
  /** 当前动作名，用于错误消息。 */
  action: string;
}): TValue | null {
  const value = read_optional_string_arg(input);
  if (value === null) return null;
  const matched = input.allowed.find((item) => item === value);
  if (matched) return matched;
  throw new CityToolRuntimeError({
    code: "invalid_args",
    message:
      `Action "${input.action}" received an unsupported value for ${input.name}: ${value}. `
      + `Supported values: ${input.allowed.join(", ")}.`,
  });
}
