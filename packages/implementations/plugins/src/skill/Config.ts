/**
 * SkillPlugin 构造参数归一化工具。
 *
 * 关键点（中文）
 * - SkillPlugin 只读取 constructor 配置，不读取项目配置文件。
 * - constructor options 是唯一行为配置入口，便于 SDK 用户直接理解。
 * - 这里只做默认值与去重，不做文件系统扫描。
 */

import type {
  ResolvedSkillPluginOptions,
  SkillPluginOptions,
} from "@/skill/types/SkillPlugin.js";

/**
 * skill plugin 默认构造参数。
 */
export const DEFAULT_SKILL_PLUGIN_OPTIONS: ResolvedSkillPluginOptions = {
  use: ["project"],
  paths: [],
  ignore: [],
};

function normalizeUse(
  input: SkillPluginOptions["use"],
): ResolvedSkillPluginOptions["use"] {
  if (!Array.isArray(input)) return [...DEFAULT_SKILL_PLUGIN_OPTIONS.use];
  const values: ResolvedSkillPluginOptions["use"] = [];
  for (const item of input) {
    if ((item === "project" || item === "home") && !values.includes(item)) {
      values.push(item);
    }
  }
  return values;
}

function normalizePaths(input: SkillPluginOptions["paths"]): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_SKILL_PLUGIN_OPTIONS.paths];
  const values: string[] = [];
  for (const item of input) {
    const value = String(item || "").trim();
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

/**
 * 读取并归一化 SkillPlugin 构造参数。
 */
export function resolveSkillPluginOptions(
  options?: SkillPluginOptions | null,
): ResolvedSkillPluginOptions {
  return {
    use: normalizeUse(options?.use),
    paths: normalizePaths(options?.paths),
    ignore: Array.isArray(options?.ignore) ? [...options.ignore] : [],
  };
}
