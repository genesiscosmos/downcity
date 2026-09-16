/**
 * city tool 分发器。
 *
 * 关键点（中文）
 * - 统一负责载荷校验、可见性判定、动作查找、执行与结果信封封装。
 * - provider 只管自己的动作语义，成功返回数据，失败抛 CityToolRuntimeError。
 * - 不可见与不存在区分开：前者 forbidden，后者 not_found，模型据此决定是否换调用。
 */

import type {
  CityToolActionSpec,
  CityToolContext,
  CityToolError,
  CityToolNamespaceProvider,
  CityToolResult,
} from "@/city/types/CityTool.js";
import { CityToolRuntimeError } from "@/city/tool/CityToolErrors.js";
import type { CityToolRegistry } from "@/city/tool/CityToolRegistry.js";

/** 模型提交给 city tool 的原始载荷。 */
export interface CityToolCallInput {
  /** 目标 namespace；省略时返回可见 namespace 索引。 */
  namespace?: unknown;
  /** 目标 action；省略时返回该 namespace 的动作索引。 */
  action?: unknown;
  /** 动作参数。 */
  args?: unknown;
}

/** 一次分发的完整输入。 */
export interface CityToolDispatchInput {
  /** 模型提交的原始载荷。 */
  call: CityToolCallInput;
  /** 当前 Agent 可见的 namespace provider。 */
  visible: readonly CityToolNamespaceProvider[];
  /** 本次调用可见的运行时事实。 */
  context: CityToolContext;
}

/** city tool 的统一分发器。 */
export class CityToolDispatcher {
  constructor(private readonly registry: CityToolRegistry) {}

  /** 校验并执行一次 city tool 调用，永远返回结果信封。 */
  async dispatch(input: CityToolDispatchInput): Promise<CityToolResult> {
    let namespace: string | null = null;
    let action: string | null = null;
    try {
      namespace = read_optional_name(input.call.namespace, "namespace");
      action = read_optional_name(input.call.action, "action");
      const args = read_args(input.call.args);
      if (!namespace) {
        return success_result({
          namespace: null,
          action: null,
          data: { namespaces: describe_namespaces(input.visible) },
        });
      }
      const provider = this.registry.get(namespace);
      if (!provider) {
        throw new CityToolRuntimeError({
          code: "not_found",
          message: `Unknown city namespace: ${namespace}.`,
          detail: { visible_namespaces: input.visible.map((item) => item.namespace) },
        });
      }
      if (!input.visible.includes(provider)) {
        throw new CityToolRuntimeError({
          code: "forbidden",
          message:
            `Namespace "${namespace}" is not enabled for agent "${input.context.agent_id}". `
            + "Do not retry it; use one of the enabled namespaces instead.",
          detail: { visible_namespaces: input.visible.map((item) => item.namespace) },
        });
      }
      if (!action) {
        return success_result({
          namespace,
          action: null,
          data: {
            namespace: provider.namespace,
            summary: provider.summary,
            actions: provider.actions.map(describe_action),
          },
        });
      }
      const spec = provider.actions.find((item) => item.action === action);
      if (!spec) {
        throw new CityToolRuntimeError({
          code: "not_found",
          message: `Unknown action "${action}" in namespace "${namespace}".`,
          detail: { available_actions: provider.actions.map((item) => item.action) },
        });
      }
      const data = await provider.handle({ action, args, context: input.context });
      return success_result({ namespace, action, data: data === undefined ? null : data });
    } catch (error) {
      return failure_result(namespace, action, to_city_error(error, namespace, action));
    }
  }
}

/** 读取可选的 snaker 名称字段。 */
function read_optional_name(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const name = typeof value === "string" ? value.trim() : "";
  if (name) return name;
  throw new CityToolRuntimeError({
    code: "invalid_args",
    message: `"${field}" must be a non-empty string when provided.`,
  });
}

/** 读取动作参数对象。 */
function read_args(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new CityToolRuntimeError({
    code: "invalid_args",
    message: "\"args\" must be a JSON object when provided.",
  });
}

/** 生成 namespace 索引条目。 */
function describe_namespaces(
  providers: readonly CityToolNamespaceProvider[],
): Record<string, unknown>[] {
  return providers.map((provider) => ({
    namespace: provider.namespace,
    summary: provider.summary,
    actions: provider.actions.map((action) => action.action),
  }));
}

/** 生成动作索引条目。 */
function describe_action(spec: CityToolActionSpec): Record<string, unknown> {
  return {
    action: spec.action,
    summary: spec.summary,
    args: spec.args.map((arg) => ({
      name: arg.name,
      type: arg.type,
      required: arg.required,
      description: arg.description,
    })),
    returns: spec.returns,
    capability: spec.capability,
  };
}

/** 构造成功信封。 */
function success_result(input: {
  /** 回显 namespace。 */
  namespace: string | null;
  /** 回显 action。 */
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

/** 构造失败信封。 */
function failure_result(
  namespace: string | null,
  action: string | null,
  error: CityToolError,
): CityToolResult {
  return { ok: false, namespace, action, data: null, error };
}

/** 把 provider 抛出的异常收敛为模型可读错误。 */
function to_city_error(
  error: unknown,
  namespace: string | null,
  action: string | null,
): CityToolError {
  if (error instanceof CityToolRuntimeError) {
    return { code: error.code, message: error.message, detail: error.detail };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return {
    code: "internal",
    message: message.trim() || "City tool failed without a message.",
    detail: { namespace, action },
  };
}
