/**
 * PluginActionRunner：plugin command/action 执行模块。
 *
 * 关键点（中文）
 * - 新模型中注册即生效，不再要求 plugin 处于 running 状态。
 * - CLI/RPC command 优先解析为同名 action，再处理 plugin 自定义命令。
 * - 延迟调度仍复用本模块，保证 schedule 到点后走统一 action 规则。
 */

import type { AgentContext } from "@/agent/AgentContext.js";
import type { PluginAction, PluginActionResult } from "@/types/plugin/PluginAction.js";
import type { PluginCommandResult } from "@/types/plugin/PluginCommand.js";
import type { PluginSnapshot } from "@/types/plugin/PluginState.js";
import type { PluginActionScheduleInput } from "@/plugin/types/ActionSchedule.js";
import type { JsonValue } from "@/types/common/Json.js";
import { ActionScheduleStore } from "@/plugin/core/ActionScheduleStore.js";
import { normalizeRunAtMsOrThrow } from "@/plugin/core/ActionScheduleTime.js";

/**
 * 按名称解析 plugin action。
 */
export function resolvePluginAction(
  plugin: {
    actions?: Record<string, PluginAction<JsonValue, JsonValue>>;
  },
  actionName: string,
): PluginAction<JsonValue, JsonValue> | null {
  const key = String(actionName || "").trim();
  if (!key) return null;
  return plugin.actions?.[key] || null;
}

/**
 * 执行一个 plugin action。
 */
export async function invokePluginAction(params: {
  pluginName: string;
  actionName: string;
  payload?: JsonValue;
  context: AgentContext;
}): Promise<PluginActionResult<JsonValue>> {
  return await params.context.plugins.runAction({
    plugin: params.pluginName,
    action: params.actionName,
    payload: params.payload,
  });
}

async function schedulePluginAction(params: {
  pluginName: string;
  command: string;
  payload?: JsonValue;
  schedule: JsonValue | PluginActionScheduleInput;
  recordSnapshot: PluginSnapshot;
  context: AgentContext;
}): Promise<PluginCommandResult & { plugin?: PluginSnapshot }> {
  try {
    const scheduleInput = params.schedule as Partial<PluginActionScheduleInput>;
    const runAtMs = normalizeRunAtMsOrThrow(
      scheduleInput.runAtMs,
      "schedule.runAtMs",
    );
    const store = new ActionScheduleStore(params.context.files);
    try {
      const job = await store.createJob({
        pluginName: params.pluginName,
        actionName: params.command,
        payload: params.payload ?? null,
        runAtMs,
      });
      return {
        success: true,
        plugin: params.recordSnapshot,
        data: {
          scheduled: true,
          jobId: job.id,
          runAtMs: job.runAtMs,
          status: job.status,
        },
      };
    } finally {
      store.close();
    }
  } catch (error) {
    return {
      success: false,
      plugin: params.recordSnapshot,
      message: String(error),
    };
  }
}

/**
 * 统一执行 plugin command。
 */
export async function runPluginCommand(params: {
  pluginName: string;
  command: string;
  payload?: JsonValue;
  schedule?: JsonValue | PluginActionScheduleInput;
  context: AgentContext;
}): Promise<PluginCommandResult & { plugin?: PluginSnapshot }> {
  const pluginName = String(params.pluginName || "").trim();
  const command = String(params.command || "")
    .trim()
    .toLowerCase();
  const plugin = params.context.plugins.get(pluginName);
  const snapshot = params.context.plugins.status(pluginName) || undefined;

  if (!plugin || !snapshot) {
    return {
      success: false,
      message: `Unknown plugin: ${params.pluginName}`,
    };
  }

  if (!command) {
    return {
      success: false,
      plugin: snapshot,
      message: "command is required",
    };
  }

  if (command === "status") {
    return {
      success: true,
      plugin: snapshot,
    };
  }

  const action = resolvePluginAction(plugin, command);
  if (params.schedule !== undefined && params.schedule !== null) {
    if (!action) {
      return {
        success: false,
        plugin: snapshot,
        message: `Scheduling only supports plugin actions. "${plugin.name}.${command}" is not a schedulable action.`,
      };
    }

    return await schedulePluginAction({
      pluginName: plugin.name,
      command,
      payload: params.payload,
      schedule: params.schedule,
      recordSnapshot: snapshot,
      context: params.context,
    });
  }

  if (action) {
    const result = await params.context.plugins.runAction({
      plugin: plugin.name,
      action: command,
      payload: params.payload,
    });

    return {
      success: result.success,
      plugin: params.context.plugins.status(plugin.name) || snapshot,
      ...(result.message || result.error
        ? { message: result.message || result.error }
        : {}),
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }

  const handler = plugin.lifecycle?.command;
  if (handler) {
    try {
      const result = await handler({
        context: params.context,
        command,
        payload: params.payload,
      });
      return {
        ...result,
        plugin: params.context.plugins.status(plugin.name) || snapshot,
      };
    } catch (error) {
      return {
        success: false,
        plugin: params.context.plugins.status(plugin.name) || snapshot,
        message: String(error),
      };
    }
  }

  return {
    success: false,
    plugin: snapshot,
    message: `Plugin "${plugin.name}" does not implement command "${command}"`,
  };
}
