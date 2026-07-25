/**
 * Plugin 顶层定义类型。
 *
 * 关键点（中文）
 * - 这里只组合 plugin 的各类能力，不展开每个能力的细节。
 * - 细节类型分散在 State / Command / Action / Runtime / Setup / HTTP 模块。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { StructuredConfig } from "@/types/plugin/PluginConfig.js";
import type { PluginActions } from "@/types/plugin/PluginAction.js";
import type {
  PluginAvailability,
  PluginConfigDefinition,
  PluginHooks,
  PluginResolves,
} from "@/types/plugin/PluginRuntime.js";
import type {
  PluginCommandContext,
  PluginLifecycle,
} from "@/types/plugin/PluginCommand.js";
import type {
  PluginSetupDefinition,
  PluginUsageDefinition,
} from "@/types/plugin/PluginSetup.js";
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
  /** Plugin 配置定义（可选）。 */
  config?: PluginConfigDefinition<StructuredConfig>;
  /** Plugin 显式 Action 集合（可选）。 */
  actions?: PluginActions;
  /**
   * Plugin setup 定义（可选）。
   *
   * 说明（中文）
   * - 这是 Console 面向用户的安装/配置协议。
   * - plugin 内部仍可复用 asset/helper，但 UI 只读取这层抽象。
   */
  setup?: PluginSetupDefinition;
  /**
   * Plugin usage 定义（可选）。
   *
   * 说明（中文）
   * - 这是 agent 侧如何使用该 plugin 的配置协议。
   * - 与 setup 不同，这里不负责依赖安装，只负责行为选择与运行参数。
   */
  usage?: PluginUsageDefinition;
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
    context: PluginCommandContext | PluginContext,
  ) => Promise<PluginAvailability> | PluginAvailability;
  /** Plugin HTTP 注入定义（可选）。 */
  http?: PluginHttpDefinition;
}
