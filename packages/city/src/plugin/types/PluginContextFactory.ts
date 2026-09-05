/**
 * Plugin 调用上下文工厂协议。
 *
 * Registry 只持有该工厂，不缓存 PluginContext。每次 Action、Hook、System 或
 * Availability 调用都由 City 按当前执行范围投影一个新的上下文。
 */

import type { PluginContext } from "./PluginContext.js";

/** 为当前执行范围中的指定 Plugin 创建一次性上下文。 */
export type PluginContextFactory = (
  /** 当前调用目标 Plugin 的稳定 ID。 */
  plugin_id: string,
) => PluginContext;
