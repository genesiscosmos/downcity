/**
 * `@downcity/powers/skill` 独立公开入口。
 *
 * 关键点（中文）
 * - 只导出 SkillPower，不加载其他内建 power 的入口模块。
 * - 适合扩展运行时按需加载 Skill 能力，避免无关 power 的依赖进入 bundle。
 */

export { SkillPower } from "./skill/Power.js";
export type {
  ResolvedSkillPowerOptions,
  SkillPowerFindPayload,
  SkillPowerIgnoreRule,
  SkillPowerInstallPayload,
  SkillPowerLookupPayload,
  SkillPowerOptions,
} from "./skill/types/SkillPower.js";
