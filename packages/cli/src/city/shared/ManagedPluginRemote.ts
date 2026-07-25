/**
 * `city plugin` 运行态远程 Agent runtime 调用辅助。
 *
 * 关键点（中文）
 * - 统一处理 list/control/command 三类需要访问 Agent runtime 的命令。
 * - 这里不负责命令注册，只负责 transport 调用与结果输出。
 */

import { printResult } from "@/city/utils/cli/CliOutput.js";
import type {
  PluginCliBaseOptions,
  PluginCommandResponse,
  PluginControlAction,
  PluginControlResponse,
  PluginStateListResponse,
} from "@downcity/agent";
import {
  parseCommandPayload,
  resolvePluginProjectRoot,
  validateAgentProjectRoot,
} from "@/city/shared/PluginTargetSupport.js";
import { callServer } from "@/city/process/daemon/Client.js";

const PLUGIN_COMMAND_TIMEOUT_MS = 120_000;

/**
 * 执行 `plugin list`。
 */
export async function runManagedPluginListCommand(options: PluginCliBaseOptions): Promise<void> {
  const resolved = await resolvePluginProjectRoot(options);
  if (!resolved.agent_id || !resolved.project_root) {
    printResult({
      asJson: options.json,
      success: false,
      title: "plugin list failed",
      payload: {
        error: resolved.error || "Failed to resolve agent project path",
      },
    });
    return;
  }
  const project_root = resolved.project_root;
  const pathError = validateAgentProjectRoot(project_root);
  if (pathError) {
    printResult({
      asJson: options.json,
      success: false,
      title: "plugin list failed",
      payload: {
        error: pathError,
      },
    });
    return;
  }
  const remote = await callServer<PluginStateListResponse>({
    agent_id: resolved.agent_id,
    path: "/api/plugins/list",
    method: "GET",
    host: options.host,
    port: options.port,
    authToken: options.token,
  });

  if (remote.success && remote.data) {
    printResult({
      asJson: options.json,
      success: Boolean(remote.data.success),
      title: remote.data.success ? "plugin listed" : "plugin list failed",
      payload: {
        ...(Array.isArray(remote.data.plugins) ? { plugins: remote.data.plugins } : {}),
        ...(remote.data.error ? { error: remote.data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: options.json,
    success: false,
    title: "plugin list failed",
    payload: {
      error: remote.error || "Unknown error",
    },
  });
}

/**
 * 执行 `plugin status/start/stop/restart`。
 */
export async function runManagedPluginControlCommand(params: {
  plugin_name: string;
  action: PluginControlAction;
  options: PluginCliBaseOptions;
}): Promise<void> {
  const resolved = await resolvePluginProjectRoot(params.options);
  if (!resolved.agent_id || !resolved.project_root) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: `plugin ${params.action} failed`,
      payload: {
        error: resolved.error || "Failed to resolve agent project path",
      },
    });
    return;
  }
  const project_root = resolved.project_root;
  const pathError = validateAgentProjectRoot(project_root);
  if (pathError) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: `plugin ${params.action} failed`,
      payload: {
        error: pathError,
      },
    });
    return;
  }
  const remote = await callServer<PluginControlResponse>({
    agent_id: resolved.agent_id,
    path: "/api/plugins/control",
    method: "POST",
    host: params.options.host,
    port: params.options.port,
    authToken: params.options.token,
    body: {
      plugin_name: params.plugin_name,
      action: params.action,
    },
  });

  if (remote.success && remote.data) {
    printResult({
      asJson: params.options.json,
      success: Boolean(remote.data.success),
      title: remote.data.success ? `plugin ${params.action} ok` : `plugin ${params.action} failed`,
      payload: {
        ...(remote.data.plugin ? { plugin: remote.data.plugin } : {}),
        ...(remote.data.error ? { error: remote.data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: params.options.json,
    success: false,
    title: `plugin ${params.action} failed`,
    payload: {
      error: remote.error || "Unknown error",
    },
  });
}

/**
 * 执行 `plugin command` 桥接。
 */
export async function runManagedPluginCommandBridge(params: {
  plugin_name: string;
  command: string;
  payloadRaw?: string;
  options: PluginCliBaseOptions;
}): Promise<void> {
  const resolved = await resolvePluginProjectRoot(params.options);
  if (!resolved.agent_id || !resolved.project_root) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin command failed",
      payload: {
        error: resolved.error || "Failed to resolve agent project path",
      },
    });
    return;
  }
  const project_root = resolved.project_root;
  const pathError = validateAgentProjectRoot(project_root);
  if (pathError) {
    printResult({
      asJson: params.options.json,
      success: false,
      title: "plugin command failed",
      payload: {
        error: pathError,
      },
    });
    return;
  }
  const remote = await callServer<PluginCommandResponse>({
    agent_id: resolved.agent_id,
    path: "/api/plugins/command",
    method: "POST",
    timeoutMs: PLUGIN_COMMAND_TIMEOUT_MS,
    host: params.options.host,
    port: params.options.port,
    authToken: params.options.token,
    body: {
      plugin_name: params.plugin_name,
      command: params.command,
      ...(params.payloadRaw !== undefined
        ? { payload: parseCommandPayload(params.payloadRaw) }
        : {}),
    },
  });

  if (remote.success && remote.data) {
    printResult({
      asJson: params.options.json,
      success: Boolean(remote.data.success),
      title: remote.data.success ? "plugin command ok" : "plugin command failed",
      payload: {
        ...(remote.data.plugin ? { plugin: remote.data.plugin } : {}),
        ...(remote.data.message ? { message: remote.data.message } : {}),
        ...(remote.data.data !== undefined ? { data: remote.data.data } : {}),
        ...(remote.data.error ? { error: remote.data.error } : {}),
      },
    });
    return;
  }

  printResult({
    asJson: params.options.json,
    success: false,
    title: "plugin command failed",
    payload: {
      error: remote.error || "Unknown error",
    },
  });
}
