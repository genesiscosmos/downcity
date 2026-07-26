/**
 * Plugin Action 解析与执行辅助。
 *
 * 关键点（中文）：Plugin 对外调用协议只有 Action，不再提供 command 兼容层。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginAction, PluginActionResult } from "@/types/plugin/PluginAction.js";
import type { JsonValue } from "@/types/common/Json.js";

/** 按名称解析一个 Plugin Action。 */
export function resolve_plugin_action(
  plugin: { actions?: Record<string, PluginAction<JsonValue, JsonValue>> },
  action_name: string,
): PluginAction<JsonValue, JsonValue> | null {
  const key = String(action_name || "").trim();
  return key ? plugin.actions?.[key] ?? null : null;
}

/** 通过当前 Plugin Registry 执行一个 Action。 */
export async function invoke_plugin_action(params: {
  /** Plugin 稳定名称。 */
  plugin_name: string;
  /** Action 稳定名称。 */
  action_name: string;
  /** 可选 JSON 输入。 */
  payload?: JsonValue;
  /** 当前 Agent Plugin Context。 */
  context: PluginContext;
}): Promise<PluginActionResult<JsonValue>> {
  return await params.context.plugins.run_action({
    plugin: params.plugin_name,
    action: params.action_name,
    payload: params.payload,
  });
}
