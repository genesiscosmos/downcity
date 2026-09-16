/**
 * city tool 的结果信封与错误收敛。
 *
 * 关键点（中文）
 * - 动作与工具层用抛出 CityToolRuntimeError 表达可预期的失败，其余异常统一收敛为 internal。
 * - 信封只在这里构造，动作对象只负责返回数据或抛错，不各自约定成败表达。
 * - 错误消息面向模型书写，必须直接说明边界或缺失依赖，而不是只报动作名。
 */

import type {
  CityToolError,
  CityToolErrorCode,
  CityToolResult,
} from "@/city/types/CityTool.js";

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

/** 构造成功信封。 */
export function city_tool_ok(input: {
  /** 回显 namespace；索引调用为 null。 */
  namespace: string | null;
  /** 回显 action；索引调用为 null。 */
  action: string | null;
  /** 成功数据。 */
  data: unknown;
}): CityToolResult {
  return {
    ok: true,
    namespace: input.namespace,
    action: input.action,
    data: input.data,
    error: null,
  };
}

/** 构造失败信封，并把任意异常收敛为模型可读错误。 */
export function city_tool_fail(input: {
  /** 回显 namespace，用于多轮调用后对账。 */
  namespace: string | null;
  /** 回显 action。 */
  action: string | null;
  /** 动作或工具层抛出的异常。 */
  error: unknown;
}): CityToolResult {
  return {
    ok: false,
    namespace: input.namespace,
    action: input.action,
    data: null,
    error: to_city_tool_error(input),
  };
}

/** 把任意异常收敛为结构化错误。 */
function to_city_tool_error(input: {
  /** 回显 namespace。 */
  namespace: string | null;
  /** 回显 action。 */
  action: string | null;
  /** 抛出的异常。 */
  error: unknown;
}): CityToolError {
  if (input.error instanceof CityToolRuntimeError) {
    return {
      code: input.error.code,
      message: input.error.message,
      detail: input.error.detail,
    };
  }
  const message = input.error instanceof Error
    ? input.error.message
    : String(input.error ?? "");
  return {
    code: "internal",
    message: message.trim() || "City tool failed without a message.",
    detail: { namespace: input.namespace, action: input.action },
  };
}
