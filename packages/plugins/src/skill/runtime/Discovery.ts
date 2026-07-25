/**
 * Skills discovery：扫描可用 skills 并生成索引。
 *
 * 关键点（中文）
 * - 扫描范围由 `paths.ts` 决定（项目、用户目录、构造参数路径）。
 * - 同名 skill 按根目录优先级“先到先得”。
 */

import fs from "fs-extra";
import yaml from "js-yaml";
import path from "path";
import type { Dirent, Stats } from "node:fs";
import { resolveSkillPluginOptions } from "../Config.js";
import { parseFrontMatter } from "./Frontmatter.js";
import { getSkillSearchRoots } from "./Paths.js";
import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type {
  SkillPluginIgnoreRule,
  SkillPluginOptions,
} from "@/skill/types/SkillPlugin.js";
import type { JsonObject, JsonValue } from "@downcity/agent";

function matchesIgnoreRule(
  skill: SkillDefinition,
  rule: SkillPluginIgnoreRule,
): boolean {
  if (typeof rule === "string") {
    const value = rule.trim().toLowerCase();
    if (!value) return false;
    return skill.id.toLowerCase() === value || skill.name.toLowerCase() === value;
  }
  if (rule instanceof RegExp) {
    rule.lastIndex = 0;
    const matchesId = rule.test(skill.id);
    rule.lastIndex = 0;
    const matchesName = rule.test(skill.name);
    rule.lastIndex = 0;
    return matchesId || matchesName;
  }
  if (typeof rule === "function") {
    return rule(skill);
  }
  return false;
}

function shouldIgnoreSkill(
  skill: SkillDefinition,
  rules: SkillPluginIgnoreRule[],
): boolean {
  for (const rule of rules) {
    if (matchesIgnoreRule(skill, rule)) return true;
  }
  return false;
}

/**
 * 扫描并发现本地 skills。
 *
 * 关键点（中文）
 * - skills 的扫描根目录与 project_root 强相关（默认 `.agents/skills`）
 * - 这里做成同步函数：启动时扫描一次，产出 prompt section 与 tools 索引
 */
/**
 * 发现技能算法（中文）
 * 1) 计算扫描根目录列表
 * 2) 逐目录读取 `SKILL.md` 与 frontmatter
 * 3) 按 id 去重并构造 SkillDefinition
 * 4) 最终按 name 排序，保证输出稳定
 */
export function discoverSkillsSync(
  project_root: string,
  options?: SkillPluginOptions | null,
): SkillDefinition[] {
  const root = String(project_root || "").trim();
  if (!root) return [];
  const resolvedOptions = resolveSkillPluginOptions(options);
  const roots = getSkillSearchRoots(root, resolvedOptions);

  const outById = new Map<string, SkillDefinition>();

  for (const r of roots) {
    const sourceRoot = r.resolved;

    if (!fs.existsSync(sourceRoot)) continue;
    let stat: Stats;
    try {
      stat = fs.statSync(sourceRoot);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let entries: Dirent[] = [];
    try {
      entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      let isDirectory = entry.isDirectory();
      if (!isDirectory && entry.isSymbolicLink()) {
        try {
          isDirectory = fs
            .statSync(path.join(sourceRoot, entry.name))
            .isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      if (!isDirectory) continue;
      const id = entry.name;
      if (!id || id.startsWith(".")) continue;
      // 去重：同 id 以 roots 优先级顺序为准（先遇到的 wins）
      if (outById.has(id)) continue;

      const directoryPath = path.join(sourceRoot, id);
      const skillMdPath = path.join(directoryPath, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      let content = "";
      try {
        content = fs.readFileSync(skillMdPath, "utf-8");
      } catch {
        continue;
      }

      const { frontMatterYaml } = parseFrontMatter(content);
      let meta: JsonObject | null = null;
      if (frontMatterYaml && frontMatterYaml.trim()) {
        try {
          const loaded = yaml.load(frontMatterYaml) as JsonValue;
          if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
            meta = loaded as JsonObject;
          } else {
            meta = null;
          }
        } catch {
          meta = null;
        }
      }

      const name =
        typeof meta?.name === "string" && meta.name.trim()
          ? meta.name.trim()
          : id;
      const description =
        typeof meta?.description === "string" ? meta.description.trim() : "";
      const allowedTools =
        meta?.["allowed-tools"] ?? meta?.allowedTools ?? meta?.allowed_tools;

      const skill: SkillDefinition = {
        id,
        name,
        description,
        sourceRoot,
        source: r.source,
        directoryPath,
        skillMdPath,
        allowedTools,
      };
      if (shouldIgnoreSkill(skill, resolvedOptions.ignore)) continue;
      outById.set(id, skill);
    }
  }

  const out = Array.from(outById.values());
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
