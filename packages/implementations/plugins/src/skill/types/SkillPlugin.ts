/**
 * Skill Plugin 协议类型。
 *
 * 关键点（中文）
 * - skill 已迁到 plugin 体系，因此把对外 action 名称与 payload 类型统一放到 `types/`。
 * - constructor options 是 skill plugin 的唯一行为配置入口。
 * - 该文件只描述插件协议，不承载发现、安装或 system 组装逻辑。
 */

import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type { SkillRootSource } from "@/skill/types/SkillRoot.js";

/**
 * skill plugin action 名称常量。
 */
export const SKILL_PLUGIN_ACTIONS = {
  /**
   * 返回查找 skill 的 Shell 操作提示。
   */
  find: "find",
  /**
   * 返回扫描感知的安装提示。
   */
  install: "install",
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
 * skill 查找提示 action 输入。
 */
export type SkillPluginFindPayload = {
  /**
   * 需要查找的 skill 关键词。
   */
  query: string;
};

/**
 * skill 安装提示 action 输入。
 */
export type SkillPluginInstallPayload = {
  /**
   * `skills` CLI 接受的安装来源或 skill spec。
   */
  spec: string;
};

/**
 * skill 读取输入。
 */
export type SkillPluginLookupPayload = {
  /**
   * 待读取的 skill 名称或 id。
   */
  name: string;
};

/**
 * skill 忽略规则。
 */
export type SkillPluginIgnoreRule =
  | string
  | RegExp
  | ((skill: SkillDefinition) => boolean);

/**
 * SkillPlugin 构造参数。
 */
export interface SkillPluginOptions {
  /**
   * 启用的内置 skill 来源。
   *
   * 说明（中文）
   * - `project` 表示扫描当前项目的 `.agents/skills`。
   * - `home` 表示扫描用户目录的 `~/.agents/skills`。
   * - 默认只启用 `project`，避免 agent 隐式读取全局 skill。
   */
  use?: Array<Extract<SkillRootSource, "project" | "home">>;
  /**
   * 额外的 skill 扫描根目录。
   *
   * 说明（中文）
   * - 相对路径基于项目根目录解析。
   * - 绝对路径与 `~` 路径会按原样解析为自定义来源。
   * - 典型值：`.agents/shared-skills`、`~/team/skills`。
   */
  paths?: string[];
  /**
   * 忽略指定 skills。
   *
   * 说明（中文）
   * - 字符串会同时匹配 skill `id` 与 `name`。
   * - `RegExp` 可用于批量过滤。
   * - 函数返回 `true` 表示忽略该 skill。
   */
  ignore?: SkillPluginIgnoreRule[];
}

/**
 * 归一化后的 SkillPlugin 构造参数。
 */
export interface ResolvedSkillPluginOptions {
  /**
   * 最终启用的内置 skill 来源。
   */
  use: Array<Extract<SkillRootSource, "project" | "home">>;
  /**
   * 最终生效的额外 skill 扫描根目录。
   */
  paths: string[];
  /**
   * 最终生效的 skill 忽略规则。
   */
  ignore: SkillPluginIgnoreRule[];
}
