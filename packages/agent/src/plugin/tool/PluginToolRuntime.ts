/**
 * Plugin Tool 运行时。
 *
 * 关键点（中文）
 * - Plugin Action 自己完成业务输出和本地文件保存。
 * - 本模块不猜测 `data` 是否为 UIMessage，也不下载、复制或挂载文件。
 * - Action 的普通字段成为 `plugin_call` output，messages 交给统一 Session Tool 边界。
 */

import type { JsonObject, JsonValue } from "@/types/common/Json.js";
import type { ActionResult } from "@/types/action/ActionResult.js";
import type {
  PluginCallInput,
  PluginCallToolResult,
  InvokePluginCallToolOptions,
  InvokePluginReadToolOptions,
  PluginReadInput,
  PluginReadToolResult,
} from "@/types/plugin/PluginTool.js";

/** 判断值是否为普通 JSON 对象。 */
function to_json_object(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

/** 调用 Plugin Action，并把 Action messages 原样交给统一 Tool Result。 */
export async function invoke_plugin_call_tool(
  params: InvokePluginCallToolOptions,
): Promise<ActionResult<PluginCallToolResult>> {
  const input: PluginCallInput = params.input;
  const plugin = String(input.plugin || "").trim();
  const action = String(input.action || "").trim();
  const payload = to_json_object(input.payload ?? {}) ?? {};
  if (!plugin || !action) {
    const error = !plugin ? "plugin is required" : "action is required";
    return {
      output: {
        success: false,
        plugin,
        action,
        message: error,
        error,
      },
      messages: [],
    };
  }

  try {
    const turn_context = params.turn_context;
    const plugins = turn_context.step.plugins || params.plugins;
    const result = await plugins.run_action({
      plugin,
      action,
      payload,
      execution_context: turn_context.step.plugin_execution_context(params.call_id),
      ...(turn_context.interactions
        ? { interactions: turn_context.interactions }
        : {}),
    });
    return {
      output: {
        success: result.success,
        plugin,
        action,
        message:
          String(result.message || result.error || "").trim() ||
          (result.success ? "plugin action completed" : "plugin action failed"),
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
        plugin,
        action,
        message: String(error),
        error: String(error),
      },
      messages: [],
    };
  }
}

/** 读取 Plugin metadata，并作为普通 JSON Tool Result 返回。 */
export async function invoke_plugin_read_tool(
  params: InvokePluginReadToolOptions,
): Promise<ActionResult<PluginReadToolResult>> {
  const input: PluginReadInput = params.input;
  try {
    const plugins = params.turn_context.step.plugins || params.plugins;
    const data = plugins.read({
      plugin: typeof input.plugin === "string" ? input.plugin : undefined,
      action: typeof input.action === "string" ? input.action : undefined,
    });
    return {
      output: {
        success: true,
        message: "plugin metadata read",
        data: data as unknown as JsonObject,
      },
      messages: [],
    };
  } catch (error) {
    return {
      output: {
        success: false,
        message: String(error),
        data: { error: String(error) },
      },
      messages: [],
    };
  }
}
