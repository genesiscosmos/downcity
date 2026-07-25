/**
 * PluginCatalog：通用 plugin 目录视图工具。
 *
 * 关键点（中文）
 * - 这里不关心 plugin 来源，不区分内建、外部、本地或远程。
 * - 调用方只需要传入当前已注册或准备展示的 plugin 实例集合。
 * - Agent 的视角只有“传入的 plugin”，目录视图和可用性检查都从这些实例推导。
 */

import type { Plugin } from "@/types/plugin/PluginDefinition.js";
import type { PluginAvailability, PluginView } from "@/types/plugin/PluginRuntime.js";
import type { PluginContext } from "@/types/plugin/PluginContext.js";

/**
 * 判断 plugin 是否声明了运行时生命周期。
 */
export function has_plugin_lifecycle(plugin: Plugin): boolean {
  return Boolean(plugin.lifecycle);
}

/**
 * 过滤出声明了运行时生命周期的 plugin。
 */
export function list_plugins_with_lifecycle<T extends Plugin>(plugins: Iterable<T>): T[] {
  return [...plugins].filter((plugin) => has_plugin_lifecycle(plugin));
}

/**
 * 过滤出没有运行时生命周期、可直接执行 action 的 plugin。
 */
export function list_plugins_without_lifecycle<T extends Plugin>(plugins: Iterable<T>): T[] {
  return [...plugins].filter((plugin) => !has_plugin_lifecycle(plugin));
}

/**
 * 按名称查找 plugin。
 */
export function find_plugin_by_name<T extends Plugin>(
  plugins: Iterable<T>,
  plugin_name: string,
): T | null {
  const key = String(plugin_name || "").trim();
  if (!key) return null;
  return [...plugins].find((plugin) => plugin.name === key) || null;
}

/**
 * 将 plugin 定义转换为目录视图。
 */
export function to_plugin_view(plugin: Plugin): PluginView {
  return {
    name: plugin.name,
    title: String(plugin.title || plugin.name || "").trim(),
    description: String(plugin.description || "").trim(),
    actions: Object.keys(plugin.actions || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    pipelines: Object.keys(plugin.hooks?.pipeline || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    guards: Object.keys(plugin.hooks?.guard || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    effects: Object.keys(plugin.hooks?.effect || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    resolves: Object.keys(plugin.resolves || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    has_system: typeof plugin.system === "function",
    has_availability: typeof plugin.availability === "function",
  };
}

/**
 * 列出 plugin 目录视图。
 */
export function list_plugin_views(plugins: Iterable<Plugin>): PluginView[] {
  return [...plugins]
    .map((plugin) => to_plugin_view(plugin))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 构建 plugin 可用性视图。
 *
 * 关键点（中文）
 * - 传入 context 时会调用 plugin 自己的 availability。
 * - 未传 context 时只返回静态目录说明，适合 Console 或 CLI 的目录回退展示。
 */
export async function resolve_plugin_availability(params: {
  plugins: Iterable<Plugin>;
  plugin_name: string;
  context?: PluginContext;
  agentError?: string;
}): Promise<PluginAvailability> {
  const plugin = find_plugin_by_name(params.plugins, params.plugin_name);
  if (!plugin) {
    return {
      enabled: false,
      available: false,
      reasons: [`Unknown plugin: ${params.plugin_name}`],
    };
  }

  if (params.context && plugin.availability) {
    return await plugin.availability(params.context);
  }

  const agentReason = String(params.agentError || "").trim();
  if (agentReason || !params.context) {
    return {
      enabled: true,
      available: false,
      reasons: agentReason
        ? [`Agent runtime unavailable: ${agentReason}`]
        : ["Static catalog view only. Agent-side availability is not loaded."],
    };
  }

  return {
    enabled: true,
    available: true,
    reasons: [],
  };
}

/**
 * 同步构建静态 plugin 可用性视图。
 */
export function build_static_plugin_availability(params: {
  plugins: Iterable<Plugin>;
  plugin_name: string;
  agentError?: string;
}): PluginAvailability {
  const plugin = find_plugin_by_name(params.plugins, params.plugin_name);
  if (!plugin) {
    return {
      enabled: false,
      available: false,
      reasons: [`Unknown plugin: ${params.plugin_name}`],
    };
  }

  const agentReason = String(params.agentError || "").trim();
  return {
    enabled: true,
    available: false,
    reasons: agentReason
      ? [`Agent runtime unavailable: ${agentReason}`]
      : ["Static catalog view only. Agent-side availability is not loaded."],
  };
}
