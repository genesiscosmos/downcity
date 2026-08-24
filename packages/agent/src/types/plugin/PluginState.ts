/**
 * Plugin 注册状态类型。
 *
 * 关键点（中文）
 * - Plugin 只属于 Agent：完成 lifecycle.start 后生效，卸载后立即不可见。
 * - 不再暴露 start / stop / restart 这类生命周期状态。
 * - `error` 只表示最近一次注册后运行发生错误，方便开发者诊断。
 */

import type { Plugin } from "@/types/plugin/PluginDefinition.js";

/**
 * Plugin 当前可观察状态。
 */
export type PluginState = "initializing" | "ready" | "error";

/**
 * 单个已注册 plugin 的运行时记录。
 */
export interface PluginRuntimeRecord {
  /** 当前 plugin 实例。 */
  plugin: Plugin;
  /** 当前可观察状态。 */
  state: PluginState;
  /** plugin 注册时间（毫秒时间戳）。 */
  registered_at: number;
  /** 最近一次状态更新时间（毫秒时间戳）。 */
  updated_at: number;
  /** 最近一次错误信息。 */
  last_error?: string;
  /** 当前串行变更链。 */
  chain: Promise<void>;
  /** lifecycle.start 是否已经执行成功。 */
  lifecycle_started: boolean;
  /** 当前正在使用该 Plugin 的 Session step lease 数量。 */
  active_execution_leases: number;
  /** 当前 Plugin 是否已从 configured registry 移除并等待释放。 */
  retired: boolean;
  /** 当前 Plugin 的延迟 lifecycle.stop 是否已经开始。 */
  retirement_started: boolean;
  /** 当前 Plugin 完成延迟 lifecycle.stop 后兑现的 Promise。 */
  retirement_promise?: Promise<void>;
  /** 兑现当前 Plugin retirement Promise 的内部回调。 */
  resolve_retirement?: () => void;
}

/**
 * 单个 plugin 注册快照。
 */
export interface PluginSnapshot {
  /** plugin 名称。 */
  name: string;
  /** plugin 标题。 */
  title: string;
  /** plugin 描述。 */
  description: string;
  /** 当前注册后的可用状态。 */
  status: PluginState;
  /** 注册时间（毫秒时间戳）。 */
  registered_at: number;
  /** 最近更新时间（毫秒时间戳）。 */
  updated_at: number;
  /** 最近错误。 */
  last_error?: string;
}
