/**
 * PluginCommand：通用 plugin action CLI 注册器。
 *
 * 关键点（中文）
 * - 这里只把调用方传入的 plugin actions 挂到 commander。
 * - 是否传入某类 plugin 由宿主决定，agent 不内置任何 plugin 清单。
 */

import path from "node:path";
import type { Command } from "commander";
import type { JsonObject, JsonValue } from "@/types/common/Json.js";
import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { PluginAction } from "@/types/plugin/PluginAction.js";
import { run_local_plugin_action } from "@/plugin/core/PluginLocalExecution.js";
import { printResult } from "@/utils/cli/CliOutput.js";

type PluginCliBridgeOptions = {
  /**
   * 项目根目录。
   */
  path?: string;
  /**
   * 是否以 JSON 输出。
   */
  json?: boolean;
};

function resolveProjectRoot(pathInput?: string): string {
  return path.resolve(String(pathInput || "."));
}

function toJsonValue(input: unknown): JsonValue | undefined {
  if (input === null) return null;
  if (typeof input === "string") return input;
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : undefined;
  }
  if (typeof input === "boolean") return input;
  if (Array.isArray(input)) {
    const values: JsonValue[] = [];
    for (const item of input) {
      const value = toJsonValue(item);
      if (value === undefined) continue;
      values.push(value);
    }
    return values;
  }
  if (typeof input === "object" && input) {
    const output: JsonObject = {};
    for (const [key, value] of Object.entries(
      input as Record<string, unknown>,
    )) {
      const normalized = toJsonValue(value);
      if (normalized === undefined) continue;
      output[key] = normalized;
    }
    return output;
  }
  return undefined;
}

function toPluginActionCommandOpts(
  options: Record<string, unknown>,
): Record<string, JsonValue> {
  const reservedKeys = new Set(["path", "host", "port", "token", "json"]);
  const normalized: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(options)) {
    if (reservedKeys.has(key)) continue;
    const nextValue = toJsonValue(value);
    if (nextValue === undefined) continue;
    normalized[key] = nextValue;
  }
  return normalized;
}

function toPluginCliBridgeOptions(
  options: Record<string, unknown>,
): PluginCliBridgeOptions {
  return {
    path: typeof options.path === "string" ? options.path : ".",
    json: options.json !== false,
  };
}

function flattenPluginActionCommandArgs(values: unknown[]): string[] {
  const out: string[] = [];
  const pushValue = (value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) pushValue(item);
      return;
    }
    const text = String(value).trim();
    if (!text) return;
    out.push(text);
  };
  for (const value of values) pushValue(value);
  return out;
}

function isCommanderCommandLike(value: unknown): value is Command {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { opts?: unknown }).opts === "function",
  );
}

function isPlainOptionsObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { opts?: unknown }).opts !== "function",
  );
}

function registerPluginActionCommand(params: {
  program: Command;
  plugins: Plugin[];
  plugin: Plugin;
  action_name: string;
  action: PluginAction<JsonValue, JsonValue>;
}): void {
  const commandSpec = params.action.command;
  if (!commandSpec) return;

  const pluginCommand =
    params.program.commands.find((item) => item.name() === params.plugin.name) ||
    params.program
      .command(params.plugin.name)
      .description(`${params.plugin.name} plugin actions`)
      .helpOption("--help", "display help for command");

  const actionCommand = pluginCommand
    .command(params.action_name)
    .description(commandSpec.description)
    .helpOption("--help", "display help for command")
    .option("--path <path>", "项目根目录（默认当前目录）", ".")
    .option("--json [enabled]", "以 JSON 输出", true);

  commandSpec.configure?.(actionCommand);

  actionCommand.action(async (...rawArgs: unknown[]) => {
    const last = rawArgs.at(-1);
    const commandLike = isCommanderCommandLike(last) ? last : null;
    const positionalArgs = commandLike
      ? flattenPluginActionCommandArgs(
          Array.isArray(commandLike.processedArgs)
            ? (commandLike.processedArgs as unknown[])
            : [],
        )
      : (() => {
          const fallbackLast = rawArgs.at(-1);
          const fallbackPositional = isPlainOptionsObject(fallbackLast)
            ? rawArgs.slice(0, -1)
            : rawArgs;
          return flattenPluginActionCommandArgs(fallbackPositional);
        })();
    const allOptions = commandLike
      ? ((commandLike.opts() as Record<string, unknown>) || {})
      : (() => {
          const fallbackLast = rawArgs.at(-1);
          return isPlainOptionsObject(fallbackLast) ? fallbackLast : {};
        })();
    const actionOptions = toPluginActionCommandOpts(allOptions);
    const bridgeOptions = toPluginCliBridgeOptions(allOptions);

    let payload: JsonValue;
    try {
      payload = await commandSpec.map_input({
        args: positionalArgs,
        opts: actionOptions,
      });
    } catch (error) {
      printResult({
        asJson: bridgeOptions.json,
        success: false,
        title: `${params.plugin.name}.${params.action_name} failed`,
        payload: {
          error: `Failed to parse command input: ${String(error)}`,
        },
      });
      return;
    }

    const local = await run_local_plugin_action({
      plugins: params.plugins,
      project_root: resolveProjectRoot(bridgeOptions.path),
      plugin_name: params.plugin.name,
      action_name: params.action_name,
      payload,
    });
    printResult({
      asJson: bridgeOptions.json,
      success: Boolean(local.success),
      title: local.success
        ? `${params.plugin.name}.${params.action_name} ok`
        : `${params.plugin.name}.${params.action_name} failed`,
      payload: {
        ...(local.data !== undefined ? { data: local.data } : {}),
        ...(local.message ? { message: local.message } : {}),
        ...(local.error ? { error: local.error } : {}),
      },
    });
  });
}

/**
 * 注册指定 plugin 集合的 action CLI 命令。
 */
export function register_plugin_action_commands_for_cli(params: {
  program: Command;
  plugins: Iterable<Plugin>;
}): void {
  const plugins = [...params.plugins];
  for (const plugin of plugins) {
    for (const [action_name, action] of Object.entries(plugin.actions || {})) {
      registerPluginActionCommand({
        program: params.program,
        plugins,
        plugin,
        action_name,
        action,
      });
    }
  }
}
