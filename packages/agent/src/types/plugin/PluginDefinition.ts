/**
 * Plugin 顶层定义类型。
 *
 * 关键点（中文）
 * - 这里只组合 plugin 的各类能力，不展开每个能力的细节。
 * - 细节类型分散在 State / Action / Runtime / Lifecycle / HTTP 模块。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginActions } from "@/types/plugin/PluginAction.js";
import type {
  PluginAvailability,
  PluginHooks,
  PluginResolves,
} from "@/types/plugin/PluginRuntime.js";
import type { PluginLifecycle } from "@/types/plugin/PluginCommand.js";
import type { PluginHttpDefinition } from "@/types/plugin/PluginHttp.js";
import type { PluginRunContext } from "@/types/plugin/PluginRunContext.js";

/**
 * Plugin 定义。
 */
export interface Plugin {
  /** Plugin 稳定名称。 */
  name: string;
  /** Plugin 面向用户界面的展示标题。 */
  title: string;
  /** Plugin 面向人类的用途说明。 */
  description: string;
  /** Plugin 显式 Action 集合（可选）。 */
  actions?: PluginActions;
  /** Plugin Hook 集合（可选）。 */
  hooks?: PluginHooks;
  /** Plugin resolve 点集合（可选）。 */
  resolves?: PluginResolves;
  /**
   * Plugin system 文本构建器（可选）。
   *
   * @param context Agent 稳定能力上下文。
   * @param run_context 当前 Session run 上下文；非 Session 快照读取时可缺省。
   */
  system?: (
    context: PluginContext,
    run_context?: PluginRunContext,
  ) => string | Promise<string>;
  /** Plugin 生命周期定义（可选）。 */
  lifecycle?: PluginLifecycle;
  /** Plugin 可用性检查器（可选）。 */
  availability?: (
    context: PluginContext,
  ) => Promise<PluginAvailability> | PluginAvailability;
  /** Plugin HTTP 注入定义（可选）。 */
  http?: PluginHttpDefinition;
}
