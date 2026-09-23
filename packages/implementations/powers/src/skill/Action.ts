/**
 * Skill 读取 helper。
 *
 * 关键点（中文）
 * - 与 runtime tool 解耦：power action 与宿主 action 共用同一份发现与读取逻辑。
 * - `lookup` 无状态：直接返回 `SKILL.md` 内容，由调用方决定如何进入模型上下文。
 */

import fs from "fs-extra";
import type { PowerJsonValue } from "@downcity/city/power";
import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type {
  SkillListResponse,
  SkillLookupRequest,
  SkillLookupResponse,
  SkillSummary,
} from "@/skill/types/SkillCommand.js";
import type {
  ResolvedSkillPowerOptions,
  SkillPowerScope,
} from "@/skill/types/SkillPower.js";
import { discover_skills } from "@/skill/runtime/Discovery.js";
import { resolve_skill_roots, type SkillRootContext } from "@/skill/runtime/Paths.js";

/**
 * 一次 skill 查询的完整输入。
 */
export interface SkillQuery {
  /**
   * 需要读取的作用域。
   */
  scope: SkillPowerScope;
  /**
   * 当前 Agent 与 Workspace 的路径事实。
   */
  context: SkillRootContext;
  /**
   * 归一化后的 power 选项。
   */
  options: ResolvedSkillPowerOptions;
}

/** 归一化 front matter 中的 `allowed-tools`。 */
function normalize_allowed_tools(input: PowerJsonValue | undefined): string[] {
  if (!Array.isArray(input)) return [];
  const values: string[] = [];
  for (const item of input) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value) continue;
    values.push(value);
  }
  return Array.from(new Set(values));
}

/** 把内部定义投影为对外摘要。 */
function to_skill_summary(skill: SkillDefinition): SkillSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    source_root: skill.source_root,
    directory_path: skill.directory_path,
    skill_md_path: skill.skill_md_path,
    is_link: skill.is_link,
    ...(skill.link_target ? { link_target: skill.link_target } : {}),
    allowed_tools: normalize_allowed_tools(skill.allowed_tools),
  };
}

/** 在已发现集合里按 id、名称精确匹配，再退化为包含匹配。 */
function find_skill(skills: SkillDefinition[], name: string): SkillDefinition | null {
  const query = String(name || "").trim().toLowerCase();
  if (!query) return null;

  return (
    skills.find((item) => item.id.toLowerCase() === query) ||
    skills.find((item) => item.name.toLowerCase() === query) ||
    skills.find((item) => item.name.toLowerCase().includes(query)) ||
    null
  );
}

/**
 * 按作用域发现 skill。
 */
export function discover_scope_skills(query: SkillQuery): SkillDefinition[] {
  const roots = resolve_skill_roots(query.scope, query.context);
  return discover_skills(roots, query.options);
}

/**
 * 列出指定作用域内的 skill。
 */
export function listSkills(query: SkillQuery): SkillListResponse {
  return {
    success: true,
    scope: query.scope,
    skills: discover_scope_skills(query).map(to_skill_summary),
  };
}

/**
 * 读取指定 skill 的正文内容。
 */
export async function lookupSkill(
  query: SkillQuery & { request: SkillLookupRequest },
): Promise<SkillLookupResponse> {
  const target = find_skill(discover_scope_skills(query), query.request.name);
  if (!target) {
    return {
      success: false,
      error: `Skill not found: ${query.request.name}`,
    };
  }

  let content = "";
  try {
    content = String(await fs.readFile(target.skill_md_path, "utf-8")).trim();
  } catch {
    content = "";
  }
  if (!content) {
    return {
      success: false,
      error: `Skill content is empty: ${target.id}`,
    };
  }

  return {
    success: true,
    skill: to_skill_summary(target),
    content,
  };
}
