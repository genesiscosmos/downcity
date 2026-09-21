/**
 * Power 工具运行时。
 *
 * 关键点（中文）
 * - 一个工具只服务一个 power，直接持有 Power 定义，执行时不再经过 Registry 二次解析。
 * - 省略 action 返回该 power 的动作索引，替代此前独立的 metadata 读取往返。
 * - Power Action 自己完成业务输出和本地文件保存；本模块不猜测 data 形状，
 *   也不下载、复制或挂载文件。Action 的 messages 交给统一 Session Tool 边界。
 * - 失败永远返回结果而不是抛错，保证模型能看到可读边界说明。
 */

import type { JsonObject, JsonValue, ActionResult } from "@downcity/type";
import type {
  PowerToolInput,
  PowerToolResult,
  InvokePowerToolOptions,
} from "@/power/types/PowerTool.js";
import type { PowerActionReadView } from "@/power/types/PowerRuntime.js";
import { execute_power_action } from "@/power/core/PowerActionExecution.js";

/** 判断值是否为普通 JSON 对象。 */
function to_json_object(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/** 把一个 action 定义投影为索引条目。 */
function to_action_summary(
  action_id: string,
  action: NonNullable<InvokePowerToolOptions["power"]["actions"]>[string],
): PowerActionReadView {
  return {
    name: action_id,
    description: String(action.description || "").trim(),
    access: action.access === "write" ? "write" : "read",
    returns: String(action.returns || "").trim(),
    has_input_schema: Boolean(action.input_schema),
    ...(action.input_schema?.json_schema
      ? { input_schema: action.input_schema.json_schema }
      : {}),
    ...(action.examples ? { examples: action.examples } : {}),
    has_command: Boolean(action.command),
    has_api: Boolean(action.api),
  };
}

/** 构造动作索引数据。 */
function build_index_data(power: InvokePowerToolOptions["power"]): JsonObject {
  const actions = Object.entries(power.actions || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([action_id, action]) => to_action_summary(action_id, action));
  return {
    power: power.name,
    title: String(power.title || power.name || "").trim(),
    description: String(power.description || "").trim(),
    actions: actions.map((action) => ({
      action: action.name,
      description: action.description,
      access: action.access,
      returns: action.returns,
      has_input_schema: action.has_input_schema,
    })),
  };
}

/** 构造一次失败结果。 */
function failure_result(
  power_name: string,
  action: string | null,
  message: string,
): ActionResult<PowerToolResult> {
  return {
    output: {
      success: false,
      power: power_name,
      action,
      message,
      error: message,
    },
    messages: [],
  };
}

/**
 * 执行一次 power 工具调用。
 *
 * 关键点（中文）
 * - 省略 action 时返回动作索引，成功语义与索引调用一致。
 * - action 直接取自工具持有的定义，不存在「power 到 action」的二次查找。
 */
export async function invoke_power_tool(
  params: InvokePowerToolOptions,
): Promise<ActionResult<PowerToolResult>> {
  const power_name = String(params.power.name || "").trim();
  const action_id = typeof params.input?.action === "string"
    ? params.input.action.trim()
    : "";
  const args = to_json_object(params.input?.args ?? {}) ?? {};

  if (!action_id) {
    return {
      output: {
        success: true,
        power: power_name,
        action: null,
        message: `${Object.keys(params.power.actions || {}).length} action(s) available on power "${power_name}"`,
        data: build_index_data(params.power),
      },
      messages: [],
    };
  }

  const action = params.power.actions?.[action_id];
  if (!action) {
    return failure_result(
      power_name,
      action_id,
      `Power "${power_name}" does not implement action "${action_id}"`,
    );
  }

  try {
    // 调用身份取自工具调用环境；环境组装交给容器运行时端口。
    const result = await execute_power_action({
      host: params.host,
      power_name,
      action_name: action_id,
      action,
      payload: args as JsonValue,
      site: params.call_context,
    });
    return {
      output: {
        success: result.success,
        power: power_name,
        action: action_id,
        message:
          String(result.message || result.error || "").trim() ||
          (result.success ? "power action completed" : "power action failed"),
        ...(result.error ? { error: result.error } : {}),
        ...(result.data === undefined
          ? {}
          : {
              data: to_json_object(result.data) || {
                kind: "json",
                value: result.data as JsonValue,
              },
            }),
      },
      messages: result.messages || [],
    };
  } catch (error) {
    return failure_result(power_name, action_id, String(error));
  }
}
