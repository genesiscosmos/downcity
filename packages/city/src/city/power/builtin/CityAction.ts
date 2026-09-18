/**
 * City 动作基类。
 *
 * 关键点（中文）
 * - 一个动作是一个对象：自己声明自己，自己执行自己。
 * - 声明（action / description / returns / access / args_schema）既驱动模型侧索引，
 *   也驱动运行时参数校验，因此不再有「声明一处、校验另一处」的漂移。
 * - `run` 成功直接返回数据；失败抛 `CityActionError`，由 power 运行时统一封成结果信封。
 * - 动作名是组内裸名；对模型暴露的点号 id 由所属组拼成 `${group}.${action}`。
 */

import type { z } from "zod";
import type {
  CityPowerContext,
  CityActionErrorCode,
} from "@/city/types/CityPowerContext.js";

/** city 动作可预期的运行时错误。 */
export class CityActionError extends Error {
  /** 机器可读错误码。 */
  readonly code: CityActionErrorCode;

  /** 便于定位的补充信息。 */
  readonly detail: Record<string, unknown> | null;

  constructor(input: {
    /** 机器可读错误码。 */
    readonly code: CityActionErrorCode;
    /** 面向模型的一句话说明。 */
    readonly message: string;
    /** 便于定位的补充信息。 */
    readonly detail?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "CityActionError";
    this.code = input.code;
    this.detail = input.detail ?? null;
  }
}

/** city 动作对外的统一视图；动作集合以它为准，避免泛型参数泄漏到集合类型。 */
export interface AnyCityAction {
  /** 动作名，snaker；组内唯一，不含组前缀。 */
  readonly action: string;
  /** 动作摘要，一行。 */
  readonly description: string;
  /** 返回结构说明。 */
  readonly returns: string;
  /** 读写性质。 */
  readonly access: "read" | "write";
  /** 参数 schema；未声明表示不接受参数。 */
  readonly args_schema?: z.ZodTypeAny;
  /** 是否在执行前请求调用方审批；只对消耗额度或高风险动作开启。 */
  readonly approval?: boolean;
  /** 执行动作；入参未经类型收窄，由动作自己做 schema 校验。 */
  execute(raw_args: unknown, context: CityPowerContext): Promise<unknown>;
}

/** city 动作的通用基类。 */
export abstract class CityAction<TArgs = Record<string, never>> implements AnyCityAction {
  /** 动作名，snaker；组内唯一，不含组前缀。 */
  abstract readonly action: string;

  /** 动作摘要，一行，进入模型侧描述与索引。 */
  abstract readonly description: string;

  /** 返回结构说明，进入模型侧索引。 */
  abstract readonly returns: string;

  /**
   * 读写性质。
   *
   * 关键点（中文）
   * - `read` 只读事实；`write` 会消耗额度、写文件或改变外部状态。
   * - 这是准确的元数据，不直接触发审批；审批由 `approval` 控制。
   */
  readonly access: "read" | "write" = "read";

  /** 是否在执行前请求调用方审批；只对消耗额度或高风险动作开启。 */
  readonly approval: boolean = false;

  /**
   * 参数 schema。
   *
   * 关键点（中文）
   * - 同时用于运行时校验与模型侧参数说明，是参数的唯一来源。
   * - 未声明表示该动作不接受任何参数。
   */
  readonly args_schema?: z.ZodTypeAny;

  /** 执行动作；成功返回数据，失败抛 `CityActionError`。 */
  protected abstract run(args: TArgs, context: CityPowerContext): Promise<unknown>;

  /**
   * 公开执行入口。
   *
   * 关键点（中文）
   * - 先按 schema 归一化入参，再交给具体的 `run`，保证校验不被某个动作漏掉。
   * - 未声明 schema 的动作只接受空入参对象。
   */
  async execute(raw_args: unknown, context: CityPowerContext): Promise<unknown> {
    return await this.run(this.parse_args(raw_args), context);
  }

  /** 按 schema 归一化入参；失败时抛出面向模型的错误。 */
  private parse_args(raw_args: unknown): TArgs {
    if (!this.args_schema) {
      // 未声明 schema 的动作不接受任何参数；静默忽略会让模型把拼错的
      // 字段当成已生效，因此与有 schema 的动作保持同样严格。
      const candidate = raw_args ?? {};
      const is_empty_object = typeof candidate === "object"
        && candidate !== null
        && !Array.isArray(candidate)
        && Object.keys(candidate as Record<string, unknown>).length === 0;
      if (is_empty_object) return {} as TArgs;
      throw new CityActionError({
        code: "invalid_args",
        message:
          `Action "${this.action}" does not accept arguments: `
          + `${Object.keys(candidate as Record<string, unknown>).join(", ") || "invalid input"}.`,
      });
    }
    const parsed = this.args_schema.safeParse(raw_args ?? {});
    if (parsed.success) return parsed.data as TArgs;
    throw new CityActionError({
      code: "invalid_args",
      message: `Action "${this.action}" received invalid arguments: ${parsed.error.message}`,
    });
  }
}
