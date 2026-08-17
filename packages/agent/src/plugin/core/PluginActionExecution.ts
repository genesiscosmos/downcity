/**
 * Plugin Action 统一执行流水线。
 *
 * 关键点（中文）
 * - Registry 负责解析 Action，本模块统一处理 payload、执行身份、取消、超时与错误结果。
 * - 超时采用协作式取消：运行时触发 abort_signal，Action 必须把信号传给网络、轮询和长任务。
 * - Action 普通失败只返回业务结果，不修改 Plugin 生命周期状态。
 */

import type { PluginAction, PluginActionResult } from "@/types/plugin/PluginAction.js";
import type { PluginActionExecutionContext } from "@/types/plugin/PluginActionExecution.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginExecutionContext } from "@/types/plugin/PluginExecutionContext.js";
import type { JsonValue } from "@/types/common/Json.js";
import { generate_id } from "@/utils/Id.js";

/** Action 超时写入 abort_signal.reason 的内部错误。 */
class PluginActionTimeoutError extends Error {
  constructor(
    readonly plugin_name: string,
    readonly action_name: string,
    readonly timeout_ms: number,
  ) {
    super(`Plugin action timed out after ${timeout_ms} ms: ${plugin_name}.${action_name}`);
    this.name = "PluginActionTimeoutError";
  }
}

/** Action 取消信号及其清理行为。 */
interface PluginActionAbortScope {
  /** 传给 Action 的统一取消信号。 */
  signal: AbortSignal;
  /** 清理上游监听与超时计时器。 */
  dispose(): void;
}

/** Action 执行流水线输入。 */
export interface ExecutePluginActionInput {
  /** 当前 Plugin Workspace 上下文。 */
  context: PluginContext;
  /** 当前 Plugin 稳定名称。 */
  plugin_name: string;
  /** 当前 Action 稳定名称。 */
  action_name: string;
  /** 当前 Action 定义。 */
  action: PluginAction<JsonValue, JsonValue>;
  /** 未校验的调用 payload。 */
  payload: JsonValue;
  /** Session 或其他入口提供的可选执行快照。 */
  execution_context?: PluginExecutionContext;
}

/** 读取异常的稳定可读文本。 */
function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 创建稳定失败结果。 */
function failure_result(message: string): PluginActionResult<JsonValue> {
  return { success: false, error: message, message };
}

/** 校验并解析 Action payload。 */
function parse_action_payload(
  input: ExecutePluginActionInput,
): PluginActionResult<JsonValue> | { input: JsonValue } {
  const schema = input.action.input_schema?.zod;
  if (!schema) return { input: input.payload };
  const parsed = schema.safeParse(input.payload);
  if (parsed.success) return { input: parsed.data as JsonValue };
  return failure_result(
    `Invalid payload for ${input.plugin_name}.${input.action_name}: ${parsed.error.message}`,
  );
}

/** 解析 Action 的可选协作式超时。 */
function resolve_timeout_ms(action: PluginAction<JsonValue, JsonValue>): number | undefined {
  if (action.timeout_ms === undefined) return undefined;
  if (!Number.isInteger(action.timeout_ms) || action.timeout_ms <= 0) {
    throw new Error("Plugin action timeout_ms must be a positive integer");
  }
  return action.timeout_ms;
}

/** 合并上游取消和 Action 超时，并返回可清理的统一信号。 */
function create_abort_scope(input: {
  plugin_name: string;
  action_name: string;
  source_signal?: AbortSignal;
  timeout_ms?: number;
}): PluginActionAbortScope {
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
          controller.abort(new PluginActionTimeoutError(
            input.plugin_name,
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

/** 把可选入口快照归一化为 Action 必定可用的完整执行上下文。 */
function create_action_execution_context(input: {
  context: PluginContext;
  execution_context?: PluginExecutionContext;
  abort_signal: AbortSignal;
}): PluginActionExecutionContext {
  const source = input.execution_context;
  const session_id = String(source?.session_id || "").trim();
  const turn_id = String(source?.turn_id || "").trim();
  const call_id = String(source?.call_id || "").trim() || `plugin:${generate_id()}`;
  return Object.freeze({
    agent_id: input.context.agent_id,
    workspace_id: input.context.workspace_id,
    call_id,
    ...(session_id ? { session_id } : {}),
    ...(turn_id ? { turn_id } : {}),
    project_root: input.context.workspace_path,
    workspace_env: Object.freeze({
      ...(source?.workspace_env ?? input.context.workspace_env ?? {}),
    }),
    agent_systems: Object.freeze([
      ...(source?.agent_systems ?? input.context.instructions ?? []),
    ]),
    abort_signal: input.abort_signal,
  });
}

/** 运行一个已经解析到具体 Plugin 的 Action。 */
export async function execute_plugin_action(
  input: ExecutePluginActionInput,
): Promise<PluginActionResult<JsonValue>> {
  const parsed_payload = parse_action_payload(input);
  if (!("input" in parsed_payload)) return parsed_payload;

  let timeout_ms: number | undefined;
  try {
    timeout_ms = resolve_timeout_ms(input.action);
  } catch (error) {
    return failure_result(
      `${input.plugin_name}.${input.action_name}: ${error_message(error)}`,
    );
  }

  const abort_scope = create_abort_scope({
    plugin_name: input.plugin_name,
    action_name: input.action_name,
    source_signal: input.execution_context?.abort_signal,
    timeout_ms,
  });
  const execution_context = create_action_execution_context({
    context: input.context,
    execution_context: input.execution_context,
    abort_signal: abort_scope.signal,
  });

  try {
    if (abort_scope.signal.aborted) {
      return failure_result(
        error_message(abort_scope.signal.reason || "Plugin action cancelled"),
      );
    }
    const result = await input.action.execute({
      context: input.context,
      execution_context,
      input: parsed_payload.input,
      plugin_name: input.plugin_name,
      action_name: input.action_name,
    });
    if (abort_scope.signal.aborted) {
      return failure_result(
        error_message(abort_scope.signal.reason || "Plugin action cancelled"),
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
