/**
 * Skills roots resolution.
 *
 * 关键点（中文）
 * - roots 分三类：项目内（project）、用户目录（home），以及构造参数路径（custom）
 * - SkillPlugin constructor 是唯一配置入口，不读取项目配置文件
 * - 兼容 `<any>/skills` 这种布局：如果 root basename 不是 `skills` 且其子目录 `skills/` 存在，则优先扫描 `<root>/skills`
 */

import fs from "fs-extra";
import path from "node:path";
import { resolveSkillPluginOptions } from "../Config.js";
import type { SkillRoot } from "@/skill/types/SkillRoot.js";
import type { SkillPluginOptions } from "@/skill/types/SkillPlugin.js";
import { expandHome, uniqStrings } from "./Utils.js";

function normalizeSkillRootCandidate(candidate: string): string {
  const normalized = path.normalize(candidate);
  const base = path.basename(normalized);
  const skillsChild = path.join(normalized, "skills");

  if (base !== "skills" && fs.existsSync(skillsChild)) {
    try {
      if (fs.statSync(skillsChild).isDirectory()) return path.normalize(skillsChild);
    } catch {
      // ignore
    }
  }
  return normalized;
}

function resolveSkillRootPath(project_root: string, raw: string): string {
  const expanded = expandHome(raw);
  return path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.resolve(project_root, expanded);
}

export function getSkillSearchRoots(
  project_root: string,
  options?: SkillPluginOptions | null,
): SkillRoot[] {
  const skillPluginOptions = resolveSkillPluginOptions(options);
  const configured = skillPluginOptions.paths.map((x) => String(x));

  const defaultsProject = skillPluginOptions.use.includes("project")
    ? [".agents/skills"]
    : [];
  const defaultsHome = skillPluginOptions.use.includes("home")
    ? ["~/.agents/skills"]
    : [];

  const rawConfigured = uniqStrings(configured);
  const rawProject = uniqStrings(defaultsProject);
  const rawHome = uniqStrings(defaultsHome);

  const roots: SkillRoot[] = [];

  // 1) project roots（最高优先级）
  for (const raw of rawProject) {
    const resolved = normalizeSkillRootCandidate(resolveSkillRootPath(project_root, raw));
    roots.push({
      source: "project",
      raw,
      resolved,
      display: raw,
      priority: 10,
      trustedWhenExternalDisabled: true,
    });
  }

  // 2) constructor paths：用户显式传入的路径，统一视为 custom 来源
  for (const raw of rawConfigured) {
    const resolved = normalizeSkillRootCandidate(resolveSkillRootPath(project_root, raw));
    roots.push({
      source: "custom",
      raw,
      resolved,
      display: raw,
      priority: 12,
      trustedWhenExternalDisabled: true,
    });
  }

  // 3) home root（用户目录）
  for (const raw of rawHome) {
    const resolved = normalizeSkillRootCandidate(resolveSkillRootPath(project_root, raw));
    roots.push({
      source: "home",
      raw,
      resolved,
      display: raw,
      priority: 20,
      trustedWhenExternalDisabled: true,
    });
  }

  // 去重：同 resolved 只保留优先级更高的那个（display/raw 以优先级更高者为准）
  const byResolved = new Map<string, SkillRoot>();
  for (const r of roots) {
    const key = path.normalize(r.resolved);
    const prev = byResolved.get(key);
    if (!prev || r.priority < prev.priority) byResolved.set(key, r);
  }

  return Array.from(byResolved.values()).sort((a, b) => a.priority - b.priority);
}
