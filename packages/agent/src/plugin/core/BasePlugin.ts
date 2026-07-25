/**
 * BasePlugin：统一 plugin 类基座。
 *
 * 关键点（中文）
 * - 主动运行型能力与被动扩展型能力统一收敛到 plugin 概念。
 * - plugin 的长期状态归属于实例本身，而不是模块级单例。
 * - Agent 注册 plugin 时自动启动 lifecycle；卸载时自动停止 lifecycle。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { PluginActions } from "@/types/plugin/PluginAction.js";
import type { PluginCommandContext, PluginLifecycle } from "@/types/plugin/PluginCommand.js";
import type {
  PluginAvailability,
  PluginConfigDefinition,
  PluginHooks,
  PluginResolves,
} from "@/types/plugin/PluginRuntime.js";
import type { PluginHttpDefinition } from "@/types/plugin/PluginHttp.js";
import type {
  PluginSetupDefinition,
  PluginUsageDefinition,
} from "@/types/plugin/PluginSetup.js";
import type { StructuredConfig } from "@/types/plugin/PluginConfig.js";
import type { PluginRunContext } from "@/types/plugin/PluginRunContext.js";

/**
 * BasePlugin 抽象基类。
 */
export abstract class BasePlugin implements Plugin {
  /**
   * 当前 plugin 名称。
   */
  abstract readonly name: string;

  /**
   * 插件标题。
   */
  readonly title: string = "";

  /**
   * 插件说明。
   */
  readonly description: string = "";

  /**
   * 插件配置定义。
   */
  readonly config?: PluginConfigDefinition<StructuredConfig>;

  /**
   * 插件 setup 协议。
   */
  readonly setup?: PluginSetupDefinition;

  /**
   * 插件 usage 协议。
   */
  readonly usage?: PluginUsageDefinition;

  /**
   * 显式 action 集合。
   */
  readonly actions: PluginActions = {};

  /**
   * pipeline / guard / effect 扩展点。
   */
  readonly hooks?: PluginHooks;

  /**
   * resolve 扩展点。
   */
  readonly resolves?: PluginResolves;

  /**
   * HTTP 路由扩展。
   */
  readonly http?: PluginHttpDefinition;

  /** Plugin 生命周期钩子。 */
  lifecycle?: PluginLifecycle;

  /**
   * Plugin 可用性检查。
   */
  availability?(
    context: PluginCommandContext | PluginContext,
  ): Promise<PluginAvailability> | PluginAvailability;

  /**
   * Plugin system 文本提供器。
   */
  system?(
    context: PluginContext,
    run_context?: PluginRunContext,
  ): Promise<string> | string;

}
