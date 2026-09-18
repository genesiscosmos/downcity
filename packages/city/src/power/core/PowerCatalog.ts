/**
 * PowerCatalog：通用 power 目录视图工具。
 *
 * 关键点（中文）
 * - 这里不关心 power 来源，不区分内建、外部、本地或远程。
 * - 调用方只需要传入当前已注册或准备展示的 power 实例集合。
 * - Agent 的视角只有“传入的 power”，目录视图和可用性检查都从这些实例推导。
 */

import type { PowerDefinition } from "@/power/index.js";
import type { PowerAvailability, PowerView } from "@/power/index.js";
import type { PowerContext } from "@/power/index.js";

/**
 * 按名称查找 power。
 */
export function find_power_by_name<T extends PowerDefinition>(
  powers: Iterable<T>,
  power_name: string,
): T | null {
  const key = String(power_name || "").trim();
  if (!key) return null;
  return [...powers].find((power) => power.name === key) || null;
}

/**
 * 将 power 定义转换为目录视图。
 */
export function to_power_view(power: PowerDefinition): PowerView {
  return {
    name: power.name,
    title: String(power.title || power.name || "").trim(),
    description: String(power.description || "").trim(),
    actions: Object.keys(power.actions || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    pipelines: Object.keys(power.hooks?.pipeline || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    guards: Object.keys(power.hooks?.guard || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    effects: Object.keys(power.hooks?.effect || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    resolves: Object.keys(power.resolves || {}).sort((left, right) =>
      left.localeCompare(right),
    ),
    has_system: typeof power.system === "function",
    has_availability: typeof power.availability === "function",
  };
}

/**
 * 列出 power 目录视图。
 */
export function list_power_views(powers: Iterable<PowerDefinition>): PowerView[] {
  return [...powers]
    .map((power) => to_power_view(power))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 构建 power 可用性视图。
 *
 * 关键点（中文）
 * - 传入 context 时会调用 power 自己的 availability。
 * - 未传 context 时只返回静态目录说明，适合 Console 或 CLI 的目录回退展示。
 */
export async function resolve_power_availability(params: {
  powers: Iterable<PowerDefinition>;
  power_name: string;
  context?: PowerContext;
  agentError?: string;
}): Promise<PowerAvailability> {
  const power = find_power_by_name(params.powers, params.power_name);
  if (!power) {
    return {
      enabled: false,
      available: false,
      reasons: [`Unknown power: ${params.power_name}`],
    };
  }

  if (params.context && power.availability) {
    return await power.availability(params.context);
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
 * 同步构建静态 power 可用性视图。
 */
export function build_static_power_availability(params: {
  powers: Iterable<PowerDefinition>;
  power_name: string;
  agentError?: string;
}): PowerAvailability {
  const power = find_power_by_name(params.powers, params.power_name);
  if (!power) {
    return {
      enabled: false,
      available: false,
      reasons: [`Unknown power: ${params.power_name}`],
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
