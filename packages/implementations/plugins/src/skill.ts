/**
 * `@downcity/plugins/skill` 独立公开入口。
 *
 * 关键点（中文）
 * - 只导出 SkillPlugin，不加载其他内建 plugin 的入口模块。
 * - 适合扩展运行时按需加载 Skill 能力，避免无关 plugin 的依赖进入 bundle。
 */

export { SkillPlugin } from "./skill/Plugin.js";
export type {
  ResolvedSkillPluginOptions,
  SkillPluginFindPayload,
  SkillPluginIgnoreRule,
  SkillPluginInstallPayload,
  SkillPluginLookupPayload,
  SkillPluginOptions,
} from "./skill/types/SkillPlugin.js";
