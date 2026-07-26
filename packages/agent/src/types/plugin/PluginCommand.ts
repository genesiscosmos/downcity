/**
 * Plugin 生命周期类型。
 *
 * 关键点（中文）：生命周期只负责启动和停止；所有显式能力调用统一使用 Action。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";

/** Plugin 生命周期定义。 */
export interface PluginLifecycle {
  /** Plugin 启动钩子。 */
  start?(context: PluginContext): Promise<void> | void;
  /** Plugin 停止钩子。 */
  stop?(context: PluginContext): Promise<void> | void;
}
