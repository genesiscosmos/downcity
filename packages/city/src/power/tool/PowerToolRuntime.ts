/**
 * Power 工具运行时。
 *
 * 关键点（中文）
 * - 一个工具只服务一个 power，因此不再需要跨 power 的名称解析。
 * - 省略 action 返回该 power 的动作索引，替代此前独立的 metadata 读取往返。
 * - Power Action 自己完成业务输出和本地文件保存；本模块不猜测 data 形状，
 *   也不下载、复制或挂载文件。Action 的 messages 交给统一 Session Tool 边界。
 */

import type { JsonObject, JsonValue, ActionResult } from "@downcity/agent";
import type {
  PowerToolInput,
  PowerToolResult,
  InvokePowerToolOptions,
} from "@/power/types/PowerTool.js";
import type { PowerReadView } from "@/power/types/PowerRuntime.js";

/** 判断值是否为普通 JSON 对象。 */
function to_json_object(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/** 把动作索引视图转换为工具结果数据。 */
function to_index_data(view: PowerReadView): JsonObject {
  return {
    power: view.name,
    title: view.title,
    description: view.description,
    actions: view.actions.map((action) => ({
      action: action.name,
      description: action.description,
      access: action.access,
      returns: action.returns,
      has_input_schema: action.has_input_schema,
    })),
  };
}

/**
 * 执行一次 power 工具调用。
 *
 * 关键点（中文）
 * - 省略 action 时返回动作索引，成功语义与索引调用一致。
 * - 失败永远返回结果而不是抛错，保证模型能看到可读边界说明。
 */
export async function invoke_power_tool(
  params: InvokePowerToolOptions,
): Promise<ActionResult<PowerToolResult>> {
  const power_name = String(params.power_name || "").trim();
  const action = typeof params.input?.action === "string" ? params.input.action.trim() : "";
  const args = to_json_object(params.input?.args ?? {}) ?? {};

  if (!action) {
    try {
      const view = params.powers.read({ power: power_name });
      if ("powers" in view) {
        return {
          output: {
            success: false,
            power: power_name,
            action: null,
            message: `Unknown power: ${power_name}`,
            error: `Unknown power: ${power_name}`,
          },
          messages: [],
        };
      }
      return {
        output: {
          success: true,
          power: power_name,
          action: null,
          message: `${view.actions.length} action(s) available on power "${power_name}"`,
          data: to_index_data(view),
        },
        messages: [],
      };
    } catch (error) {
      return {
        output: {
          success: false,
          power: power_name,
          action: null,
          message: String(error),
          error: String(error),
        },
        messages: [],
      };
    }
  }

  try {
    const turn_context = params.turn_context;
    const snapshot = turn_context.step.hook_context(params.call_id);
    const result = await params.powers.run_action({
      power: power_name,
      action,
      payload: args as JsonValue,
      // Executor 注入的工具上下文随快照下传，需要宿主能力的动作（如 shell 审批网关）读它。
      execution_context: {
        ...snapshot,
        ...(params.tool_context ? { tool_context: params.tool_context } : {}),
      },
      ...(turn_context.interactions ? { interactions: turn_context.interactions } : {}),
    });
    return {
      output: {
        success: result.success,
        power: power_name,
        action,
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
    return {
      output: {
        success: false,
        power: power_name,
        action,
        message: String(error),
        error: String(error),
      },
      messages: [],
    };
  }
}
