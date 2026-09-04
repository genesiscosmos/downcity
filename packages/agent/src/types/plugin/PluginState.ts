/** PluginRegistry 内部状态及 @downcity/plugin 的公开快照协议。 */

import type { Plugin, PluginState } from "@downcity/plugin";

export type { PluginSnapshot, PluginState } from "@downcity/plugin";

/** PluginRegistry 持有的可变生命周期记录。 */
export interface PluginRuntimeRecord {
  /** 当前 Plugin 执行模块。 */
  plugin: Plugin;
  /** 当前可观察状态。 */
  state: PluginState;
  /** Plugin 注册时间。 */
  registered_at: number;
  /** 最近状态更新时间。 */
  updated_at: number;
  /** 最近一次生命周期错误。 */
  last_error?: string;
  /** 当前串行变更链。 */
  chain: Promise<void>;
  /** lifecycle.start 是否已经完成。 */
  lifecycle_started: boolean;
  /** 当前活跃 Session execution lease 数量。 */
  active_execution_leases: number;
  /** 当前记录是否已经从可见集合移除。 */
  retired: boolean;
  /** 延迟 stop 是否已经开始。 */
  retirement_started: boolean;
  /** 延迟 stop 完成 Promise。 */
  retirement_promise?: Promise<void>;
  /** 完成延迟 stop 的内部回调。 */
  resolve_retirement?: () => void;
}
