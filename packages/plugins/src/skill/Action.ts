/**
 * skill plugin action helper。
 *
 * 关键点（中文）
 * - 与 runtime tool 解耦：CLI / plugin action / server 都可统一复用。
 * - `lookup` 采用无状态实现：直接返回 `SKILL.md` 内容，不做 pin 持久化。
 */

import fs from "fs-extra";
import path from "node:path";
import { discoverSkillsSync } from "@/skill/runtime/Discovery.js";
import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type { JsonValue } from "@downcity/agent";
import type {
  SkillListResponse,
  SkillLookupRequest,
  SkillLookupResponse,
  SkillSummary,
} from "@/skill/types/SkillCommand.js";
import type { SkillPluginOptions } from "@/skill/types/SkillPlugin.js";

function normalizeAllowedTools(input: JsonValue | undefined): string[] {
  if (!Array.isArray(input)) return [];
  const values: string[] = [];
  for (const item of input) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value) continue;
    values.push(value);
  }
  return Array.from(new Set(values));
}

function toSkillSummary(skill: SkillDefinition): SkillSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description || "",
    source: skill.source,
    skillMdPath: skill.skillMdPath,
    allowedTools: normalizeAllowedTools(skill.allowedTools),
  };
}

function findSkillExact(
  skills: SkillDefinition[],
  name: string,
): SkillDefinition | null {
  const q = String(name || "").trim().toLowerCase();
  if (!q) return null;

  return (
    skills.find((item) => item.id.toLowerCase() === q) ||
    skills.find((item) => item.name.toLowerCase() === q) ||
    null
  );
}

function findSkill(skills: SkillDefinition[], name: string): SkillDefinition | null {
  const q = String(name || "").trim().toLowerCase();
  if (!q) return null;

  return (
    skills.find((item) => item.id.toLowerCase() === q) ||
    skills.find((item) => item.name.toLowerCase() === q) ||
    skills.find((item) => item.name.toLowerCase().includes(q)) ||
    null
  );
}

function getSkills(
  project_root: string,
  options?: SkillPluginOptions | null,
): SkillDefinition[] {
  const root = path.resolve(project_root);
  return discoverSkillsSync(root, options);
}

/**
 * 在“已学会（本地可发现）”技能里做精确匹配。
 */
export function findLearnedSkillExact(
  project_root: string,
  query: string,
  options?: SkillPluginOptions | null,
): SkillSummary | null {
  const skills = getSkills(project_root, options);
  const target = findSkillExact(skills, query);
  return target ? toSkillSummary(target) : null;
}

/**
 * 在“已学会（本地可发现）”技能里做模糊搜索。
 */
export function searchLearnedSkills(
  project_root: string,
  query: string,
  limit: number = 10,
  options?: SkillPluginOptions | null,
): SkillSummary[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];

  const skills = getSkills(project_root, options);
  const matched = skills.filter((item) => {
    const id = item.id.toLowerCase();
    const name = item.name.toLowerCase();
    const description = String(item.description || "").toLowerCase();
    return id.includes(q) || name.includes(q) || description.includes(q);
  });

  return matched.slice(0, Math.max(1, limit)).map(toSkillSummary);
}

/**
 * 列出当前项目下可发现的全部 skill。
 */
export function listSkills(
  project_root: string,
  options?: SkillPluginOptions | null,
): SkillListResponse {
  const skills = getSkills(project_root, options).map(toSkillSummary);
  return {
    success: true,
    skills,
  };
}

/**
 * 读取指定 skill 的正文内容。
 */
export async function lookupSkill(params: {
  /**
   * 项目根目录。
   */
  project_root: string;
  /**
   * skill lookup 请求。
   */
  request: SkillLookupRequest;
  /**
   * SkillPlugin 构造参数。
   */
  options?: SkillPluginOptions | null;
}): Promise<SkillLookupResponse> {
  const root = path.resolve(params.project_root);
  const skills = getSkills(root, params.options);
  const target = findSkill(skills, params.request.name);
  if (!target) {
    return {
      success: false,
      error: `Skill not found: ${params.request.name}`,
    };
  }

  let content = "";
  try {
    content = String(await fs.readFile(target.skillMdPath, "utf-8")).trim();
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
    skill: toSkillSummary(target),
    content,
  };
}
