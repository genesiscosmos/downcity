/**
 * PluginActionRunner：plugin command/action 执行模块。
 *
 * 关键点（中文）
 * - 新模型中注册即生效，不再要求 plugin 处于 running 状态。
 * - CLI/RPC command 优先解析为同名 action，再处理 plugin 自定义命令。
 * - 延迟调度仍复用本模块，保证 schedule 到点后走统一 action 规则。
 */

import type { PluginContext } from "@/types/plugin/PluginContext.js";
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
  action_name: string,
): PluginAction<JsonValue, JsonValue> | null {
  const key = String(action_name || "").trim();
  if (!key) return null;
  return plugin.actions?.[key] || null;
}

/**
 * 执行一个 plugin action。
 */
export async function invokePluginAction(params: {
  plugin_name: string;
  action_name: string;
  payload?: JsonValue;
  context: PluginContext;
}): Promise<PluginActionResult<JsonValue>> {
  return await params.context.plugins.run_action({
    plugin: params.plugin_name,
    action: params.action_name,
    payload: params.payload,
  });
}

async function schedulePluginAction(params: {
  plugin_name: string;
  command: string;
  payload?: JsonValue;
  schedule: JsonValue | PluginActionScheduleInput;
  record_snapshot: PluginSnapshot;
  context: PluginContext;
}): Promise<PluginCommandResult & { plugin?: PluginSnapshot }> {
  try {
    const scheduleInput = params.schedule as Partial<PluginActionScheduleInput>;
    const run_at_ms = normalizeRunAtMsOrThrow(
      scheduleInput.run_at_ms,
      "schedule.run_at_ms",
    );
    const store = new ActionScheduleStore(params.context.files);
    try {
      const job = await store.create_job({
        plugin_name: params.plugin_name,
        action_name: params.command,
        payload: params.payload ?? null,
        run_at_ms,
      });
      return {
        success: true,
        plugin: params.record_snapshot,
        data: {
          scheduled: true,
          job_id: job.id,
          run_at_ms: job.run_at_ms,
          status: job.status,
        },
      };
    } finally {
      store.close();
    }
  } catch (error) {
    return {
      success: false,
      plugin: params.record_snapshot,
      message: String(error),
    };
  }
}

/**
 * 统一执行 plugin command。
 */
export async function run_plugin_command(params: {
  plugin_name: string;
  command: string;
  payload?: JsonValue;
  schedule?: JsonValue | PluginActionScheduleInput;
  context: PluginContext;
}): Promise<PluginCommandResult & { plugin?: PluginSnapshot }> {
  const plugin_name = String(params.plugin_name || "").trim();
  const command = String(params.command || "")
    .trim()
    .toLowerCase();
  const plugin = params.context.plugins.get(plugin_name);
  const snapshot = params.context.plugins.status(plugin_name) || undefined;

  if (!plugin || !snapshot) {
    return {
      success: false,
      message: `Unknown plugin: ${params.plugin_name}`,
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
      plugin_name: plugin.name,
      command,
      payload: params.payload,
      schedule: params.schedule,
      record_snapshot: snapshot,
      context: params.context,
    });
  }

  if (action) {
    const result = await params.context.plugins.run_action({
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
