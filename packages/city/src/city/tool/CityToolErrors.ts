/**
 * city tool 的错误码与错误构造。
 *
 * 关键点（中文）
 * - provider 用抛出 CityToolRuntimeError 表达可预期的失败，其余异常由 dispatcher 收敛为 internal。
 * - 错误消息面向模型书写，必须直接说明边界或缺失依赖，而不是只报动作名。
 */

import type { CityToolErrorCode } from "@/city/types/CityTool.js";

/** city tool 可预期的运行时错误。 */
export class CityToolRuntimeError extends Error {
  /** 机器可读错误码。 */
  readonly code: CityToolErrorCode;

  /** 便于定位的补充信息。 */
  readonly detail: Record<string, unknown> | null;

  constructor(input: {
    /** 机器可读错误码。 */
    code: CityToolErrorCode;
    /** 面向模型的一句话说明。 */
    message: string;
    /** 便于定位的补充信息。 */
    detail?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "CityToolRuntimeError";
    this.code = input.code;
    this.detail = input.detail ?? null;
  }
}

/** 构造 provider 收到未声明动作时的错误。 */
export function unexpected_city_tool_action(input: {
  /** 当前 namespace。 */
  namespace: string;
  /** provider 收到的动作名。 */
  action: string;
}): CityToolRuntimeError {
  return new CityToolRuntimeError({
    code: "not_found",
    message: `Unknown action "${input.action}" in namespace "${input.namespace}".`,
  });
}
