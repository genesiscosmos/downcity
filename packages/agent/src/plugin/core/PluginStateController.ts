/**
 * Plugin 注册状态读取模块。
 *
 * 关键点（中文）
 * - 新模型中 plugin 只有注册 / 卸载，不再暴露 start / stop / restart。
 * - 控制动作与类型协议保持一致，只支持状态查询和卸载。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginSnapshot } from "@/types/plugin/PluginState.js";

/**
 * 列出当前 Agent 已注册 plugin 快照。
 */
export function list_plugin_states(input?: {
  context?: PluginContext;
}): PluginSnapshot[] {
  return input?.context?.plugins.snapshots() || [];
}
