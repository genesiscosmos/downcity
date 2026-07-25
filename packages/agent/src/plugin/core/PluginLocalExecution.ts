/**
 * PluginLocalExecution：通用本地 plugin action 执行工具。
 *
 * 关键点（中文）
 * - 这里不创建或维护任何全局注册表，调用方必须显式传入 plugin 集合。
 * - 用于 CLI / 控制面这类没有运行中 Agent 实例、但需要执行 setup action 的场景。
 * - 真正运行中的 Agent 仍应优先使用 `Agent.plugins.run_action`。
 */

import path from "node:path";
import { get_logger } from "@/utils/logger/Logger.js";
import { resolve_workspace_env } from "@/workspace/WorkspaceEnv.js";
import { find_plugin_by_name } from "@/plugin/core/PluginCatalog.js";
import type { JsonValue } from "@/types/common/Json.js";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { PluginActionResult } from "@/types/plugin/PluginAction.js";
import type { PluginCommandContext } from "@/types/plugin/PluginCommand.js";
import type { PluginAvailability } from "@/types/plugin/PluginRuntime.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";

type LocalPluginCommandContextInput = {
  /** 当前项目根目录。 */
  project_root: string;
  /** 当前 Agent 稳定标识。 */
  agent_id?: string;
};

/**
 * 创建本地 plugin 命令上下文。
 */
export function create_local_plugin_command_context(
  input: string | LocalPluginCommandContextInput,
): PluginCommandContext {
  const project_root = typeof input === "string" ? input : input.project_root;
  const workspace_path = path.resolve(String(project_root || "").trim() || ".");
  const workspace_env = resolve_workspace_env(workspace_path);
  const agent_id = String(
    typeof input === "string" ? "" : input.agent_id || "",
  ).trim() || path.basename(workspace_path) || "agent";

  const logger = get_logger(workspace_path);

  return {
    agent_id,
    workspace_path,
    logger,
    workspace_env,
  };
}

/**
 * 读取本地 plugin availability。
 */
export async function get_local_plugin_availability(params: {
  plugins: Iterable<Plugin>;
  project_root: string;
  plugin_name: string;
  agent_id?: string;
}): Promise<PluginAvailability> {
  const plugin = find_plugin_by_name(params.plugins, params.plugin_name);
  if (!plugin) {
    return {
      enabled: false,
      available: false,
      reasons: [`Unknown plugin: ${params.plugin_name}`],
    };
  }

  const context = create_local_plugin_command_context({
    project_root: params.project_root,
    agent_id: params.agent_id,
  });
  if (plugin.availability) {
    return await plugin.availability(context);
  }

  return {
    enabled: true,
    available: true,
    reasons: [],
  };
}

/**
 * 直接执行本地 plugin action。
 */
export async function run_local_plugin_action(params: {
  plugins: Iterable<Plugin>;
  project_root: string;
  plugin_name: string;
  action_name: string;
  payload?: JsonValue;
  agent_id?: string;
}): Promise<PluginActionResult<JsonValue>> {
  const plugin = find_plugin_by_name(params.plugins, params.plugin_name);
  if (!plugin) {
    return {
      success: false,
      error: `Unknown plugin: ${params.plugin_name}`,
      message: `Unknown plugin: ${params.plugin_name}`,
    };
  }

  const action_name = String(params.action_name || "").trim();
  if (!action_name) {
    return {
      success: false,
      error: "action is required",
      message: "action is required",
    };
  }

  const action = plugin.actions?.[action_name];
  if (!action) {
    return {
      success: false,
      error: `Plugin "${plugin.name}" does not implement action "${action_name}"`,
      message: `Plugin "${plugin.name}" does not implement action "${action_name}"`,
    };
  }

  const context = create_local_plugin_command_context({
    project_root: params.project_root,
    agent_id: params.agent_id,
  });

  try {
    const payload = (params.payload ?? {}) as JsonValue;
    const schema = action.input_schema?.zod;
    const parsed_payload = schema ? schema.safeParse(payload) : null;
    if (parsed_payload && !parsed_payload.success) {
      return {
        success: false,
        error: `Invalid payload for ${plugin.name}.${action_name}: ${parsed_payload.error.message}`,
        message: `Invalid payload for ${plugin.name}.${action_name}`,
      };
    }
    const input_payload = parsed_payload?.success
      ? parsed_payload.data as JsonValue
      : payload;
    return await action.execute({
      context: context as unknown as PluginContext,
      input: input_payload,
      plugin_name: plugin.name,
      action_name,
    });
  } catch (error) {
    return {
      success: false,
      error: String(error),
      message: String(error),
    };
  }
}
