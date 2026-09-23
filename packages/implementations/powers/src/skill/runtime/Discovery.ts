/**
 * Skill 发现：扫描可用 skill 并生成稳定定义集合。
 *
 * 关键点（中文）
 * - 扫描范围由 `Paths.ts` 解析；同名 skill 按根优先级「先到先得」。
 * - 软链接目录按目标目录处理，并额外记录 `is_link` 与 `link_target`，
 *   用于区分「安装进 Agent 目录」与「关联外部目录」。
 */

import fs from "fs-extra";
import yaml from "js-yaml";
import path from "node:path";
import type { Dirent, Stats } from "node:fs";
import type { PowerJsonObject, PowerJsonValue } from "@downcity/city/power";
import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type { SkillRoot } from "@/skill/types/SkillRoot.js";
import type {
  SkillPowerIgnoreRule,
  ResolvedSkillPowerOptions,
} from "@/skill/types/SkillPower.js";
import { parse_front_matter } from "./Frontmatter.js";

/** 判断一个 skill 是否命中忽略规则。 */
function matches_ignore_rule(
  skill: SkillDefinition,
  rule: SkillPowerIgnoreRule,
): boolean {
  if (typeof rule === "string") {
    const value = rule.trim().toLowerCase();
    if (!value) return false;
    return skill.id.toLowerCase() === value || skill.name.toLowerCase() === value;
  }
  if (rule instanceof RegExp) {
    rule.lastIndex = 0;
    const matches_id = rule.test(skill.id);
    rule.lastIndex = 0;
    const matches_name = rule.test(skill.name);
    rule.lastIndex = 0;
    return matches_id || matches_name;
  }
  if (typeof rule === "function") {
    return rule(skill);
  }
  return false;
}

/** 判断一个 skill 是否应被忽略。 */
function should_ignore_skill(
  skill: SkillDefinition,
  rules: SkillPowerIgnoreRule[],
): boolean {
  for (const rule of rules) {
    if (matches_ignore_rule(skill, rule)) return true;
  }
  return false;
}

/** 读取目录项的真实目录状态，并保留软链接信息。 */
function resolve_directory_entry(
  entry: Dirent,
  directory_path: string,
): { is_directory: boolean; is_link: boolean; link_target?: string } {
  if (entry.isDirectory()) {
    return { is_directory: true, is_link: false };
  }
  if (!entry.isSymbolicLink()) {
    return { is_directory: false, is_link: false };
  }

  let is_directory = false;
  let link_target: string | undefined;
  try {
    is_directory = fs.statSync(directory_path).isDirectory();
    link_target = fs.realpathSync(directory_path);
  } catch {
    return { is_directory: false, is_link: true };
  }
  return { is_directory, is_link: true, ...(link_target ? { link_target } : {}) };
}

/** 读取 `SKILL.md` front matter 中的元数据。 */
function read_skill_metadata(content: string): PowerJsonObject | null {
  const { front_matter_yaml } = parse_front_matter(content);
  if (!front_matter_yaml || !front_matter_yaml.trim()) return null;
  try {
    const loaded = yaml.load(front_matter_yaml) as PowerJsonValue;
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      return loaded as PowerJsonObject;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 扫描一个根目录下的全部 skill。
 *
 * 关键点（中文）：目录不可读时返回空集合，由上层决定是否提示。
 */
export function discover_skills_in_root(
  root: SkillRoot,
  options: ResolvedSkillPowerOptions,
): SkillDefinition[] {
  const source_root = root.resolved;

  let stat: Stats;
  try {
    stat = fs.statSync(source_root);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  let entries: Dirent[] = [];
  try {
    entries = fs.readdirSync(source_root, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillDefinition[] = [];
  for (const entry of entries) {
    const id = entry.name;
    if (!id || id.startsWith(".")) continue;

    const directory_path = path.join(source_root, id);
    const resolved_entry = resolve_directory_entry(entry, directory_path);
    if (!resolved_entry.is_directory) continue;

    const skill_md_path = path.join(directory_path, "SKILL.md");
    if (!fs.existsSync(skill_md_path)) continue;

    let content = "";
    try {
      content = fs.readFileSync(skill_md_path, "utf-8");
    } catch {
      continue;
    }

    const metadata = read_skill_metadata(content);
    const name =
      typeof metadata?.name === "string" && metadata.name.trim()
        ? metadata.name.trim()
        : id;
    const description =
      typeof metadata?.description === "string" ? metadata.description.trim() : "";
    const allowed_tools =
      metadata?.["allowed-tools"] ?? metadata?.allowedTools ?? metadata?.allowed_tools;

    const skill: SkillDefinition = {
      id,
      name,
      description,
      source: root.source,
      source_root,
      directory_path,
      skill_md_path,
      is_link: resolved_entry.is_link,
      ...(resolved_entry.link_target ? { link_target: resolved_entry.link_target } : {}),
      allowed_tools,
    };
    if (should_ignore_skill(skill, options.ignore)) continue;
    skills.push(skill);
  }
  return skills;
}

/**
 * 按根优先级扫描并合并 skill。
 *
 * 算法（中文）
 * 1) 按 `roots` 顺序逐个扫描，先到的根优先。
 * 2) 同 id 只保留优先级更高的那一个。
 * 3) 最终按 name 排序，保证输出稳定。
 */
export function discover_skills(
  roots: SkillRoot[],
  options: ResolvedSkillPowerOptions,
): SkillDefinition[] {
  const by_id = new Map<string, SkillDefinition>();
  for (const root of roots) {
    for (const skill of discover_skills_in_root(root, options)) {
      if (by_id.has(skill.id)) continue;
      by_id.set(skill.id, skill);
    }
  }
  return Array.from(by_id.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}
