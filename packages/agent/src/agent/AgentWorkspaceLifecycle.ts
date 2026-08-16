/**
 * AgentWorkspace 内部生命周期。
 *
 * 职责说明（中文）
 * - 让 Agent 注册的 Plugin 进入当前 Workspace。
 * - 为当前 Workspace 独立启动 ActionSchedule。
 * - 离开 Workspace 时只释放 Workspace 资源，不注销 Agent Plugin。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
import type { PluginRegistry } from "@/plugin/core/PluginRegistry.js";
import {
  start_action_schedule_runtime,
  type ActionScheduleRuntimeHandle,
} from "@/plugin/core/ActionScheduleRuntime.js";

/** Agent 在单个 Workspace 中使用的内部生命周期。 */
export class AgentWorkspaceLifecycle {
  private readonly ready_promise: Promise<void>;
  private action_schedule: ActionScheduleRuntimeHandle | null = null;

  constructor(
    private readonly context: PluginContext,
    private readonly plugins: PluginRegistry,
  ) {
    this.ready_promise = this.start();
  }

  /** 等待当前 Workspace 执行入口完成初始化。 */
  async ensure_ready(): Promise<void> {
    await this.ready_promise;
  }

  /** 停止当前 Workspace 独享的后台资源。 */
  async dispose(): Promise<void> {
    await this.ready_promise.catch(() => undefined);
    this.action_schedule?.stop();
    this.action_schedule = null;
    await this.plugins.leave_workspace(this.context);
  }

  /** 进入 Plugin Workspace 生命周期并启动当前 Workspace 的 ActionSchedule。 */
  private async start(): Promise<void> {
    const snapshots = await this.plugins.enter_workspace(this.context);
    for (const item of snapshots) {
      if (item.status !== "error") continue;
      this.context.logger.error(
        `Plugin start failed: ${item.name} - ${item.last_error || "unknown error"}`,
      );
    }
    try {
      this.action_schedule = await start_action_schedule_runtime(this.context);
    } catch (error) {
      this.context.logger.error(`ActionSchedule start failed: ${String(error)}`);
    }
  }
}
