/**
 * Plugin 注册状态控制模块。
 *
 * 关键点（中文）
 * - 新模型中 plugin 只有注册 / 卸载，不再暴露 start / stop / restart。
 * - 控制动作与类型协议保持一致，只支持状态查询和卸载。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type {
  PluginControlAction,
  PluginControlResult,
  PluginSnapshot,
} from "@/types/plugin/PluginState.js";

/**
 * 列出当前 Agent 已注册 plugin 快照。
 */
export function list_plugin_states(input?: {
  context?: PluginContext;
}): PluginSnapshot[] {
  return input?.context?.plugins.snapshots() || [];
}

/**
 * 执行 plugin 控制动作。
 */
export async function control_plugin_state(params: {
  plugin_name: string;
  action: PluginControlAction;
  context: PluginContext;
}): Promise<PluginControlResult> {
  const plugin_name = String(params.plugin_name || "").trim();
  if (!plugin_name) {
    return {
      success: false,
      error: "plugin_name is required",
    };
  }

  const action = String(params.action || "").trim().toLowerCase();
  if (action === "status") {
    const plugin = params.context.plugins.status(plugin_name);
    return plugin
      ? { success: true, plugin }
      : { success: false, error: `Unknown plugin: ${plugin_name}` };
  }

  if (action === "unregister") {
    const plugin = params.context.plugins.status(plugin_name) || undefined;
    const success = await params.context.plugins.unregister(plugin_name);
    return success
      ? { success: true, ...(plugin ? { plugin } : {}) }
      : { success: false, error: `Unknown plugin: ${plugin_name}` };
  }

  return {
    success: false,
    error: `Unsupported plugin control action: ${params.action}`,
  };
}
