/**
 * Power Action 统一执行流水线。
 *
 * 关键点（中文）
 * - Registry 负责解析 Action，本模块统一处理 payload、调用身份、取消、超时与错误结果。
 * - 超时采用协作式取消：运行时触发 abort_signal，Action 必须把信号传给网络、轮询和长任务。
 * - 环境组装交给 `PowerContextProvider`：本模块只负责「造出 call，然后请容器补齐环境」。
 * - Action 普通失败只返回业务结果，不修改 Power 生命周期状态。
 */

import type { PowerAction, PowerActionResult } from "@/power/index.js";
import type { PowerCallSite, PowerRuntimeHost } from "@/power/index.js";
import type { JsonValue } from "@downcity/type";

/** Action 超时写入 abort_signal.reason 的内部错误。 */
class PowerActionTimeoutError extends Error {
  constructor(
    readonly power_name: string,
    readonly action_name: string,
    readonly timeout_ms: number,
  ) {
    super(`Power action timed out after ${timeout_ms} ms: ${power_name}.${action_name}`);
    this.name = "PowerActionTimeoutError";
  }
}

/** Action 取消信号及其清理行为。 */
interface PowerActionAbortScope {
  /** 传给 Action 的统一取消信号。 */
  signal: AbortSignal;
  /** 清理上游监听与超时计时器。 */
  dispose(): void;
}

/** Action 执行流水线输入。 */
export interface ExecutePowerActionInput {
  /** 容器运行时端口；用于组装本次调用的环境。 */
  host: PowerRuntimeHost;
  /** 当前 Power 稳定名称。 */
  power_name: string;
  /** 当前 Action 稳定名称。 */
  action_name: string;
  /** 当前 Action 定义。 */
  action: PowerAction<JsonValue, JsonValue>;
  /** 未校验的调用 payload。 */
  payload: JsonValue;
  /** 本次调用的来源身份。 */
  site: PowerCallSite;
}

/** 读取异常的稳定可读文本。 */
function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 创建稳定失败结果。 */
function failure_result(message: string): PowerActionResult<JsonValue> {
  return { success: false, error: message, message };
}

/** 校验并解析 Action payload。 */
function parse_action_payload(
  input: ExecutePowerActionInput,
): PowerActionResult<JsonValue> | { input: JsonValue } {
  const schema = input.action.input_schema?.zod;
  if (!schema) return { input: input.payload };
  const parsed = schema.safeParse(input.payload);
  if (parsed.success) return { input: parsed.data as JsonValue };
  return failure_result(
    `Invalid payload for ${input.power_name}.${input.action_name}: ${parsed.error.message}`,
  );
}

/** 解析 Action 的可选协作式超时。 */
function resolve_timeout_ms(action: PowerAction<JsonValue, JsonValue>): number | undefined {
  if (action.timeout_ms === undefined) return undefined;
  if (!Number.isInteger(action.timeout_ms) || action.timeout_ms <= 0) {
    throw new Error("Power action timeout_ms must be a positive integer");
  }
  return action.timeout_ms;
}

/** 合并上游取消和 Action 超时，并返回可清理的统一信号。 */
function create_abort_scope(input: {
  power_name: string;
  action_name: string;
  source_signal?: AbortSignal;
  timeout_ms?: number;
}): PowerActionAbortScope {
  if (!input.timeout_ms && input.source_signal) {
    return { signal: input.source_signal, dispose: () => undefined };
  }

  const controller = new AbortController();
  const abort_from_source = () => {
    if (!controller.signal.aborted) controller.abort(input.source_signal?.reason);
  };
  if (input.source_signal?.aborted) {
    abort_from_source();
  } else {
    input.source_signal?.addEventListener("abort", abort_from_source, { once: true });
  }

  const timeout_ms = input.timeout_ms;
  const timeout = timeout_ms
    ? setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort(new PowerActionTimeoutError(
            input.power_name,
            input.action_name,
            timeout_ms,
          ));
        }
      }, timeout_ms)
    : undefined;

  return {
    signal: controller.signal,
    dispose: () => {
      input.source_signal?.removeEventListener("abort", abort_from_source);
      if (timeout) clearTimeout(timeout);
    },
  };
}

/** 运行一个已经解析到具体 Power 的 Action。 */
export async function execute_power_action(
  input: ExecutePowerActionInput,
): Promise<PowerActionResult<JsonValue>> {
  const parsed_payload = parse_action_payload(input);
  if (!("input" in parsed_payload)) return parsed_payload;

  let timeout_ms: number | undefined;
  try {
    timeout_ms = resolve_timeout_ms(input.action);
  } catch (error) {
    return failure_result(
      `${input.power_name}.${input.action_name}: ${error_message(error)}`,
    );
  }

  const abort_scope = create_abort_scope({
    power_name: input.power_name,
    action_name: input.action_name,
    source_signal: input.site.abort_signal,
    timeout_ms,
  });

  try {
    if (abort_scope.signal.aborted) {
      return failure_result(
        error_message(abort_scope.signal.reason || "Power action cancelled"),
      );
    }
    // 超时信号必须传给动作，因此以覆盖后的来源身份交给容器组装环境。
    const context = input.host.context_for(input.power_name, {
      ...input.site,
      abort_signal: abort_scope.signal,
    });
    const result = await input.action.execute({
      context,
      input: parsed_payload.input,
      power_name: input.power_name,
      action_name: input.action_name,
    });
    if (abort_scope.signal.aborted) {
      return failure_result(
        error_message(abort_scope.signal.reason || "Power action cancelled"),
      );
    }
    return result;
  } catch (error) {
    return failure_result(
      abort_scope.signal.aborted
        ? error_message(abort_scope.signal.reason || error)
        : error_message(error),
    );
  } finally {
    abort_scope.dispose();
  }
}
