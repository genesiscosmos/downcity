/**
 * AgentState：本地 Agent 长期运行状态与生命周期。
 *
 * 职责说明（中文）
 * - 统一连接 PluginRegistry 与 PluginContext。
 * - 持有 Plugin lifecycle 与 ActionSchedule 的启动状态。
 * - Agent 构造完成后立即开始启动，调用方通过 `ready()` 等待。
 * - Agent 释放时统一停止 ActionSchedule 与 Plugin lifecycle。
 * - RPC / HTTP 等 transport 不属于 AgentState，由上游宿主独立管理。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import type { AgentStateOptions } from "@/types/agent/AgentState.js";
import {
  startActionScheduleRuntime,
  type ActionScheduleRuntimeHandle,
} from "@/plugin/core/ActionScheduleRuntime.js";

/**
 * 本地 Agent 长期运行状态。
 */
export class AgentState {
  /** 当前 Agent 共用的执行上下文。 */
  private readonly context: PluginContext;

  /** 当前 Agent 唯一的 PluginRegistry 实例。 */
  private readonly plugins: PluginRegistry;

  /** Plugin lifecycle 与 ActionSchedule 的唯一启动 Promise。 */
  private readonly ready_promise: Promise<void>;

  /** Plugin lifecycle 是否已经完成启动流程。 */
  private plugins_started = false;

  /** 当前 Agent 持有的 ActionSchedule 轮询运行时。 */
  private action_schedule_runtime: ActionScheduleRuntimeHandle | null = null;

  constructor(options: AgentStateOptions) {
    this.context = options.context;
    this.plugins = options.plugins;
    this.plugins.bind_context(this.context);
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
      await this.context.plugins.unregister_all();
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
    const snapshots = await this.plugins.start_all();
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

}
