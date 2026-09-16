/**
 * City Tool 动作基类。
 *
 * 关键点（中文）
 * - 一个动作是一个对象：自己声明自己，自己执行自己。
 * - 声明（action / summary / args / returns）既驱动模型侧索引，也驱动运行时参数校验，
 *   因此不再有「声明一处、校验另一处」的漂移。
 * - `run` 成功直接返回数据；失败抛 CityToolRuntimeError，由工具层统一封成信封。
 */

import type {
  CityToolArgSpec,
  CityToolCapability,
  CityToolContext,
  CityToolSensitivity,
} from "@/city/types/CityTool.js";
import { CityToolRuntimeError } from "@/city/tool/CityToolErrors.js";

/** 动作收到的原始参数。 */
export type CityToolArgs = Readonly<Record<string, unknown>>;

/** 声明一个必填或可选的字符串参数。 */
export function string_arg(
  name: string,
  description: string,
  required = true,
): CityToolArgSpec {
  return { name, type: "string", required, description };
}

/** city tool 的一个动作。 */
export abstract class CityAction {
  /** 动作名，snaker。 */
  abstract readonly action: string;

  /** 动作用途的一行摘要，进入模型侧描述。 */
  abstract readonly summary: string;

  /** 返回结构说明，进入模型侧描述。 */
  abstract readonly returns: string;

  /** 参数声明；同时是模型侧说明与运行时校验依据。 */
  readonly args: readonly CityToolArgSpec[] = [];

  /** 读写性质；第一期全部为 read。 */
  readonly capability: CityToolCapability = "read";

  /** 敏感级别；决定是否参与默认可见集合。 */
  readonly sensitivity: CityToolSensitivity = "public";

  /** 执行动作，成功返回数据；由 `execute` 在参数校验后调用。 */
  protected abstract run(args: CityToolArgs, context: CityToolContext): Promise<unknown>;

  /**
   * 公开执行入口。
   *
   * 关键点（中文）
   * - 先拒绝未声明的参数，再交给具体的 `run`，保证校验不被某个动作漏掉。
   * - 工具层只调用本方法，不直接调用 `run`。
   */
  async execute(args: CityToolArgs, context: CityToolContext): Promise<unknown> {
    this.assert_known_args(args);
    return await this.run(args, context);
  }

  /** 本动作对模型侧索引的自描述。 */
  describe(): Record<string, unknown> {
    return {
      action: this.action,
      summary: this.summary,
      args: this.args.map((arg) => ({
        name: arg.name,
        type: arg.type,
        required: arg.required,
        description: arg.description,
      })),
      returns: this.returns,
      capability: this.capability,
    };
  }

  /** 拒绝未声明的参数，避免模型静默传错字段后拿到默认结果。 */
  protected assert_known_args(args: CityToolArgs): void {
    const unknown_names = Object.keys(args)
      .filter((name) => !this.args.some((arg) => arg.name === name));
    if (unknown_names.length === 0) return;
    throw new CityToolRuntimeError({
      code: "invalid_args",
      message:
        `Action "${this.action}" does not accept argument(s): ${unknown_names.join(", ")}. `
        + `Supported arguments: ${this.arg_names_label()}.`,
    });
  }

  /** 读取必填字符串参数；缺失或非法直接失败。 */
  protected require_string(args: CityToolArgs, name: string): string {
    const value = this.optional_string(args, name);
    if (value !== null) return value;
    throw new CityToolRuntimeError({
      code: "invalid_args",
      message: `Action "${this.action}" requires a non-empty string argument: ${name}.`,
    });
  }

  /** 读取可选字符串参数；缺失或非法返回 null。 */
  protected optional_string(args: CityToolArgs, name: string): string | null {
    const raw_value = args[name];
    if (raw_value === undefined || raw_value === null) return null;
    const value = typeof raw_value === "string" ? raw_value.trim() : "";
    return value || null;
  }

  /** 读取可选枚举参数；缺失返回 null，非法值直接失败。 */
  protected optional_enum<TValue extends string>(
    args: CityToolArgs,
    name: string,
    allowed: readonly TValue[],
  ): TValue | null {
    const value = this.optional_string(args, name);
    if (value === null) return null;
    const matched = allowed.find((item) => item === value);
    if (matched) return matched;
    throw new CityToolRuntimeError({
      code: "invalid_args",
      message:
        `Action "${this.action}" received an unsupported value for ${name}: ${value}. `
        + `Supported values: ${allowed.join(", ")}.`,
    });
  }

  /** 把声明的参数名拼成错误消息里的一段。 */
  private arg_names_label(): string {
    return this.args.length > 0 ? this.args.map((arg) => arg.name).join(", ") : "none";
  }
}
