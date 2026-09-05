/**
 * City Plugin Registry 内部执行记录。
 *
 * 该类型只描述 City 拥有的可变运行状态，不进入 Agent 的公开领域模型。
 */

import type { PluginDefinition } from "@/plugin/index.js";

/** Plugin Registry 持有的可变执行记录。 */
export interface PluginRuntimeRecord {
  /** 当前 Plugin 执行模块。 */
  plugin: PluginDefinition;
  /** Plugin 注册时间。 */
  registered_at: number;
  /** 当前活跃 Session execution lease 数量。 */
  active_execution_leases: number;
  /** 当前记录是否已经从可见集合移除。 */
  retired: boolean;
  /** 全部 execution lease 释放完成的 Promise。 */
  retirement_promise?: Promise<void>;
  /** 完成 execution lease 等待的内部回调。 */
  resolve_retirement?: () => void;
}
