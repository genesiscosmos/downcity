/**
 * SkillPower 构造参数归一化工具。
 *
 * 关键点（中文）
 * - SkillPower 只读取 constructor 配置，不读取项目配置文件。
 * - 作用域由 Agent 私有目录与 action 参数表达，因此这里只处理 ignore。
 * - 这里只做默认值与复制，不做文件系统扫描。
 */

import type {
  ResolvedSkillPowerOptions,
  SkillPowerOptions,
} from "@/skill/types/SkillPower.js";

/**
 * skill power 默认构造参数。
 */
export const DEFAULT_SKILL_POWER_OPTIONS: ResolvedSkillPowerOptions = {
  ignore: [],
};

/**
 * 读取并归一化 SkillPower 构造参数。
 */
export function resolveSkillPowerOptions(
  options?: SkillPowerOptions | null,
): ResolvedSkillPowerOptions {
  return {
    ignore: Array.isArray(options?.ignore) ? [...options.ignore] : [],
  };
}
