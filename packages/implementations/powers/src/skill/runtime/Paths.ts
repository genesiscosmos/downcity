/**
 * Skill 扫描根解析。
 *
 * 关键点（中文）
 * - 权威来源是 Agent 私有目录：`<agent_root>/<agent-id>`。
 * - `project` 与 `home` 是额外可读来源，不参与 Agent 默认可用集合。
 * - 同名 skill 按 `agent > project > home` 覆盖，因此优先级数值递增。
 */

import path from "node:path";
import type { SkillRoot, SkillRootSource } from "@/skill/types/SkillRoot.js";
import { expand_home } from "./Utils.js";

/**
 * Agent 私有 skill 根下的相对目录名。
 *
 * 说明（中文）
 * - Agent 根由 Power 生命周期存储派生，见 `runtime/AgentRoot.ts`。
 */
export const AGENT_SKILLS_DIRECTORY = "agents";

/** 项目内 skill 相对路径。 */
const PROJECT_SKILLS_RELATIVE = path.join(".agents", "skills");

/** 用户目录 skill 相对路径。 */
const HOME_SKILLS_RELATIVE = path.join(".agents", "skills");

/**
 * 一次扫描所需的全部环境事实。
 */
export interface SkillRootContext {
  /**
   * 当前 Agent 的私有 skill 根目录绝对路径。
   *
   * 说明（中文）
   * - 该路径下的 `<agent-id>` 子目录即当前 Agent 的可用 skill 集合。
   */
  agent_root: string;
  /**
   * 当前 Agent 稳定标识。
   */
  agent_id: string;
  /**
   * 当前 Workspace 根目录绝对路径。
   */
  workspace_path: string;
  /**
   * 用户目录绝对路径。
   *
   * 说明（中文）
   * - 由调用方传入，便于测试与沙箱环境替换。
   */
  home_path: string;
}

/** 把绝对路径中的用户目录折叠为 `~`，用于稳定展示。 */
function collapse_home(value: string, home_path: string): string {
  const home = String(home_path || "").trim();
  const normalized = path.normalize(value);
  if (!home) return normalized;
  const relative = path.relative(path.resolve(home), normalized);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return normalized;
  return relative ? `~/${relative}` : "~";
}

/**
 * 解析单个来源的扫描根。
 *
 * 关键点（中文）：返回 null 表示当前上下文没有该来源，调用方应跳过。
 */
export function resolve_skill_root(
  source: SkillRootSource,
  context: SkillRootContext,
): SkillRoot | null {
  if (source === "agent") {
    const agent_id = String(context.agent_id || "").trim();
    if (!agent_id) return null;
    const resolved = path.join(context.agent_root, agent_id);
    return {
      source,
      resolved: path.normalize(resolved),
      display: collapse_home(resolved, context.home_path),
      priority: 10,
    };
  }

  if (source === "project") {
    const resolved = path.resolve(context.workspace_path, PROJECT_SKILLS_RELATIVE);
    return {
      source,
      resolved: path.normalize(resolved),
      display: PROJECT_SKILLS_RELATIVE,
      priority: 20,
    };
  }

  const resolved = path.join(expand_home("~", context.home_path), HOME_SKILLS_RELATIVE);
  return {
    source,
    resolved: path.normalize(resolved),
    display: `~/${HOME_SKILLS_RELATIVE}`,
    priority: 30,
  };
}

/**
 * 解析一次查询实际要扫描的根集合。
 *
 * 算法（中文）
 * 1) `agent` 只返回 Agent 私有根。
 * 2) `project` / `home` 只返回对应来源。
 * 3) `all` 返回三者，并按优先级去重与排序。
 */
export function resolve_skill_roots(
  scope: "agent" | "project" | "home" | "all",
  context: SkillRootContext,
): SkillRoot[] {
  const sources: SkillRootSource[] =
    scope === "all" ? ["agent", "project", "home"] : [scope];

  const roots: SkillRoot[] = [];
  for (const source of sources) {
    const root = resolve_skill_root(source, context);
    if (root) roots.push(root);
  }
  return roots.sort((left, right) => left.priority - right.priority);
}
