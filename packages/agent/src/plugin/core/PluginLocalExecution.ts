/**
 * PluginLocalExecution：通用本地 plugin action 执行工具。
 *
 * 关键点（中文）
 * - 这里不创建或维护任何全局注册表，调用方必须显式传入 plugin 集合。
 * - 用于 CLI / 控制面这类没有运行中 Agent 实例、但需要执行 setup action 的场景。
 * - 真正运行中的 Agent 仍应优先使用 `Agent.plugins.runAction`。
 */

import path from "node:path";
import { getLogger } from "@/utils/logger/Logger.js";
import { resolve_agent_env } from "@/agent/AgentEnv.js";
import { findPluginByName } from "@/plugin/core/PluginCatalog.js";
import type { JsonValue } from "@/types/common/Json.js";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { PluginActionResult } from "@/types/plugin/PluginAction.js";
import type { PluginCommandContext } from "@/types/plugin/PluginCommand.js";
import type { PluginAvailability } from "@/types/plugin/PluginRuntime.js";
import type { AgentContext } from "@/agent/AgentContext.js";

type LocalPluginCommandContextInput = {
  /** 当前项目根目录。 */
  projectRoot: string;
  /** 当前 Agent 稳定标识。 */
  agent_id?: string;
};

/**
 * 创建本地 plugin 命令上下文。
 */
export function createLocalPluginCommandContext(
  input: string | LocalPluginCommandContextInput,
): PluginCommandContext {
  const projectRoot = typeof input === "string" ? input : input.projectRoot;
  const rootPath = path.resolve(String(projectRoot || "").trim() || ".");
  const env = resolve_agent_env(rootPath);
  const agent_id = String(
    typeof input === "string" ? "" : input.agent_id || "",
  ).trim() || path.basename(rootPath) || "agent";

  const logger = getLogger(rootPath);

  return {
    agent_id,
    rootPath,
    logger,
    env,
  };
}

/**
 * 读取本地 plugin availability。
 */
export async function getLocalPluginAvailability(params: {
  plugins: Iterable<Plugin>;
  projectRoot: string;
  pluginName: string;
  agent_id?: string;
}): Promise<PluginAvailability> {
  const plugin = findPluginByName(params.plugins, params.pluginName);
  if (!plugin) {
    return {
      enabled: false,
      available: false,
      reasons: [`Unknown plugin: ${params.pluginName}`],
    };
  }

  const context = createLocalPluginCommandContext({
    projectRoot: params.projectRoot,
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
export async function runLocalPluginAction(params: {
  plugins: Iterable<Plugin>;
  projectRoot: string;
  pluginName: string;
  actionName: string;
  payload?: JsonValue;
  agent_id?: string;
}): Promise<PluginActionResult<JsonValue>> {
  const plugin = findPluginByName(params.plugins, params.pluginName);
  if (!plugin) {
    return {
      success: false,
      error: `Unknown plugin: ${params.pluginName}`,
      message: `Unknown plugin: ${params.pluginName}`,
    };
  }

  const actionName = String(params.actionName || "").trim();
  if (!actionName) {
    return {
      success: false,
      error: "action is required",
      message: "action is required",
    };
  }

  const action = plugin.actions?.[actionName];
  if (!action) {
    return {
      success: false,
      error: `Plugin "${plugin.name}" does not implement action "${actionName}"`,
      message: `Plugin "${plugin.name}" does not implement action "${actionName}"`,
    };
  }

  const context = createLocalPluginCommandContext({
    projectRoot: params.projectRoot,
    agent_id: params.agent_id,
  });

  try {
    const payload = (params.payload ?? {}) as JsonValue;
    const schema = action.input_schema?.zod;
    const parsed_payload = schema ? schema.safeParse(payload) : null;
    if (parsed_payload && !parsed_payload.success) {
      return {
        success: false,
        error: `Invalid payload for ${plugin.name}.${actionName}: ${parsed_payload.error.message}`,
        message: `Invalid payload for ${plugin.name}.${actionName}`,
      };
    }
    const input_payload = parsed_payload?.success
      ? parsed_payload.data as JsonValue
      : payload;
    return await action.execute({
      context: context as unknown as AgentContext,
      input: input_payload,
      pluginName: plugin.name,
      actionName,
    });
  } catch (error) {
    return {
      success: false,
      error: String(error),
      message: String(error),
    };
  }
}
