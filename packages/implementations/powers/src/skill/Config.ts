/**
 * SkillPower 构造参数归一化工具。
 *
 * 关键点（中文）
 * - SkillPower 只读取 constructor 配置，不读取项目配置文件。
 * - constructor options 是唯一行为配置入口，便于 SDK 用户直接理解。
 * - 这里只做默认值与去重，不做文件系统扫描。
 */

import type {
  ResolvedSkillPowerOptions,
  SkillPowerOptions,
} from "@/skill/types/SkillPower.js";

/**
 * skill power 默认构造参数。
 */
export const DEFAULT_SKILL_POWER_OPTIONS: ResolvedSkillPowerOptions = {
  use: ["project"],
  paths: [],
  ignore: [],
};

function normalizeUse(
  input: SkillPowerOptions["use"],
): ResolvedSkillPowerOptions["use"] {
  if (!Array.isArray(input)) return [...DEFAULT_SKILL_POWER_OPTIONS.use];
  const values: ResolvedSkillPowerOptions["use"] = [];
  for (const item of input) {
    if ((item === "project" || item === "home") && !values.includes(item)) {
      values.push(item);
    }
  }
  return values;
}

function normalizePaths(input: SkillPowerOptions["paths"]): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_SKILL_POWER_OPTIONS.paths];
  const values: string[] = [];
  for (const item of input) {
    const value = String(item || "").trim();
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

/**
 * 读取并归一化 SkillPower 构造参数。
 */
export function resolveSkillPowerOptions(
  options?: SkillPowerOptions | null,
): ResolvedSkillPowerOptions {
  return {
    use: normalizeUse(options?.use),
    paths: normalizePaths(options?.paths),
    ignore: Array.isArray(options?.ignore) ? [...options.ignore] : [],
  };
}
