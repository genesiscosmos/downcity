/**
 * Skill Power 协议类型。
 *
 * 关键点（中文）
 * - 对外 action 名称与 payload 类型统一放在 `types/`。
 * - 作用域由 Agent 私有目录 + action 参数表达，不再依赖构造参数。
 * - 该文件只描述协议，不承载发现、安装或 system 组装逻辑。
 */

import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type { SkillRootSource } from "@/skill/types/SkillRoot.js";

/**
 * skill power action 名称常量。
 */
export const SKILL_POWER_ACTIONS = {
  /**
   * 列出当前可发现的 skill。
   */
  list: "list",
  /**
   * 读取 skill 正文。
   */
  lookup: "lookup",
} as const;

/**
 * skill 列表可读取的作用域。
 *
 * 说明（中文）
 * - `agent`：仅当前 Agent 私有目录，默认值。
 * - `project`：仅当前 Workspace 的 `.agents/skills`。
 * - `home`：仅用户目录的 `~/.agents/skills`。
 * - `all`：三者并集，同名时按 `agent > project > home` 覆盖。
 */
export type SkillPowerScope =
  | "agent"
  | Extract<SkillRootSource, "project" | "home">
  | "all";

/**
 * skill 列表输入。
 */
export type SkillPowerListPayload = {
  /**
   * 需要读取的作用域；省略时只看当前 Agent 私有目录。
   */
  scope?: SkillPowerScope;
};

/**
 * skill 读取输入。
 */
export type SkillPowerLookupPayload = {
  /**
   * 待读取的 skill 名称或 id。
   */
  name: string;
  /**
   * 查找范围；省略时只看当前 Agent 私有目录。
   */
  scope?: SkillPowerScope;
};

/**
 * skill 忽略规则。
 */
export type SkillPowerIgnoreRule =
  | string
  | RegExp
  | ((skill: SkillDefinition) => boolean);

/**
 * SkillPower 构造参数。
 */
export interface SkillPowerOptions {
  /**
   * 忽略指定 skills。
   *
   * 说明（中文）
   * - 字符串会同时匹配 skill `id` 与 `name`。
   * - `RegExp` 可用于批量过滤。
   * - 函数返回 `true` 表示忽略该 skill。
   */
  ignore?: SkillPowerIgnoreRule[];
}

/**
 * 归一化后的 SkillPower 构造参数。
 */
export interface ResolvedSkillPowerOptions {
  /**
   * 最终生效的 skill 忽略规则。
   */
  ignore: SkillPowerIgnoreRule[];
}
