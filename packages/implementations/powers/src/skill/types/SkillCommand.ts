/**
 * Skill 命令协议类型。
 *
 * 关键点（中文）
 * - 统一描述 skill list / lookup 的 power action 数据结构。
 * - 这些类型不绑定具体实现模块，避免再次退回到历史 service 目录。
 */

import type { SkillPowerScope } from "@/skill/types/SkillPower.js";

/**
 * skill 摘要信息。
 */
export type SkillSummary = {
  /**
   * skill 稳定标识，通常等于目录名。
   */
  id: string;
  /**
   * skill 展示名称。
   */
  name: string;
  /**
   * skill 简要描述。
   */
  description: string;
  /**
   * skill 所属扫描根来源类型。
   */
  source: string;
  /**
   * skill 所属扫描根的绝对路径。
   */
  source_root: string;
  /**
   * skill 目录的绝对路径。
   */
  directory_path: string;
  /**
   * `SKILL.md` 的绝对路径。
   */
  skill_md_path: string;
  /**
   * 该 skill 目录是否为软链接。
   */
  is_link: boolean;
  /**
   * 软链接指向的绝对路径；非软链接时不设置。
   */
  link_target?: string;
  /**
   * 归一化后的允许工具列表。
   */
  allowed_tools: string[];
};

/**
 * skill 列表响应。
 */
export type SkillListResponse = {
  /**
   * 本次列表读取是否成功。
   */
  success: true;
  /**
   * 本次读取实际使用的作用域。
   */
  scope: SkillPowerScope;
  /**
   * 当前作用域内可发现的 skill 摘要集合。
   */
  skills: SkillSummary[];
};

/**
 * skill lookup 请求。
 */
export type SkillLookupRequest = {
  /**
   * 待读取的 skill 名称或标识。
   */
  name: string;
};

/**
 * skill lookup 响应。
 */
export type SkillLookupResponse = {
  /**
   * lookup 是否成功。
   */
  success: boolean;
  /**
   * 命中的 skill 摘要。
   */
  skill?: SkillSummary;
  /**
   * `SKILL.md` 正文内容。
   *
   * 说明（中文）
   * - 仅在命中 skill 且成功读取文件时返回。
   */
  content?: string;
  /**
   * 失败时的错误信息。
   */
  error?: string;
};
