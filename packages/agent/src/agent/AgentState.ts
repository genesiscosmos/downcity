/**
 * AgentState：本地 Agent 长期运行状态与生命周期。
 *
 * 职责说明（中文）
 * - 统一连接 PluginRegistry、AgentContext、AgentSessions 与共享 tools。
 * - 持有 Plugin lifecycle 与 ActionSchedule 的启动状态。
 * - Agent 构造完成后立即开始启动，调用方通过 `ready()` 等待。
 * - Agent 释放时统一停止 ActionSchedule 与 Plugin lifecycle。
 * - RPC / HTTP 等 transport 不属于 AgentState，由上游宿主独立管理。
 */

import type { Tool } from "ai";
import type { AgentContext } from "@/agent/AgentContext.js";
import type { AgentSessions } from "@/agent/AgentSessions.js";
import type { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type { AgentStateOptions } from "@/types/agent/AgentState.js";
import { createPluginTools } from "@executor/tools/plugin/PluginToolDefinition.js";
import { generateId } from "@/utils/Id.js";
import {
  startActionScheduleRuntime,
  type ActionScheduleRuntimeHandle,
} from "@/plugin/core/ActionScheduleRuntime.js";

/**
 * 本地 Agent 长期运行状态。
 */
export class AgentState {
  /** 当前 Agent 共用的执行上下文。 */
  private readonly context: AgentContext;

  /** 当前 Agent 唯一的 PluginRegistry 实例。 */
  private readonly plugins: PluginRegistry;

  /** 当前 Agent 唯一的 Session 集合。 */
  private readonly sessions: AgentSessions;

  /** 当前 Agent 与 Session 共享的可变工具集合。 */
  private readonly tools: Record<string, Tool>;

  /** Plugin lifecycle 与 ActionSchedule 的唯一启动 Promise。 */
  private readonly ready_promise: Promise<void>;

  /** Plugin lifecycle 是否已经完成启动流程。 */
  private plugins_started = false;

  /** 当前 Agent 持有的 ActionSchedule 轮询运行时。 */
  private action_schedule_runtime: ActionScheduleRuntimeHandle | null = null;

  constructor(options: AgentStateOptions) {
    this.context = options.context;
    this.plugins = options.plugins;
    this.sessions = options.sessions;
    this.tools = options.tools;

    this.plugins.bind_context(this.context);
    this.ensure_plugin_tools();
    this.plugins.set_change_listener(({ type, plugin_name }) => {
      this.handle_plugin_change(type, plugin_name);
    });
    this.ready_promise = this.start_runtime();
  }

  /**
   * 等待当前 Agent 持有的长期运行时启动完成。
   */
  async ready(): Promise<void> {
    await this.ready_promise;
  }

  /**
   * 释放当前 Agent 持有的长期运行时对象。
   */
  async dispose(): Promise<void> {
    await this.ready_promise.catch(() => undefined);
    this.action_schedule_runtime?.stop();
    this.action_schedule_runtime = null;
    if (this.plugins_started) {
      await this.context.plugins.unregisterAll();
      this.plugins_started = false;
    }
  }

  /**
   * 启动 Plugin lifecycle 与 ActionSchedule。
   *
   * 关键点（中文）
   * - Plugin lifecycle 先启动，避免到期任务调用未就绪的 Plugin。
   * - 单个 Plugin 启动失败由 PluginRegistry 隔离，只记录错误并继续启动 Agent。
   * - ActionSchedule 启动失败不阻断 Agent ready。
   */
  private async start_runtime(): Promise<void> {
    const snapshots = await this.plugins.startAll();
    this.plugins_started = true;
    for (const item of snapshots) {
      if (item.status === "error") {
        this.context.logger.error(
          `Plugin start failed: ${item.name} - ${item.last_error || "unknown error"}`,
        );
      }
    }

    try {
      this.action_schedule_runtime = await startActionScheduleRuntime(
        this.context,
      );
    } catch (error) {
      this.context.logger.error(
        `ActionSchedule start failed: ${String(error)}`,
      );
    }
  }

  /**
   * 确保带 action 的 PluginRegistry 已连接通用调用工具。
   *
   * 关键点（中文）
   * - 初始 Plugin 与运行中动态注册 Plugin 统一走这里。
   * - 只补充缺失工具，不覆盖调用方提供的同名自定义工具。
   * - tools 是 AgentSessions 与 Session 共享引用，原地写入会立即对现有 Session 生效。
   */
  private ensure_plugin_tools(): void {
    if (!this.plugins.list().some((plugin) => plugin.actions.length > 0)) {
      return;
    }
    const plugin_tools = createPluginTools({ plugins: this.plugins });
    this.tools.plugin_read = this.tools.plugin_read || plugin_tools.plugin_read;
    this.tools.plugin_call = this.tools.plugin_call || plugin_tools.plugin_call;
  }

  /**
   * 处理 PluginRegistry 修改后的 Agent 运行时同步。
   */
  private handle_plugin_change(
    type: "register" | "unregister",
    plugin_name: string,
  ): void {
    this.ensure_plugin_tools();
    const verb = type === "register" ? "registered" : "unregistered";
    this.sessions.broadcast_plugins({
      command_id: generateId(),
      title: `Agent plugin ${plugin_name} ${verb}`,
      plugins: this.plugins.execution_view(),
    });
  }
}
