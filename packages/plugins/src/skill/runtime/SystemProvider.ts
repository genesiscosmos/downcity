/**
 * Skill plugin system 文本构建器。
 *
 * 关键点（中文）
 * - 只负责输出“可用技能概览”提示词
 * - 不再读取/写入 pinnedSkillIds，不做会话级技能注入
 * - `lookup` 行为为无状态：由 action 读取 SKILL.md 后通过协议注入 user message
 */

import type { PluginRunContext } from "@downcity/agent";
import { discoverSkillsSync } from "./Discovery.js";
import { render_skills_prompt_section } from "./Prompt.js";
import { setSessionAvailableSkills } from "./Store.js";
import type { SkillPluginOptions } from "@/skill/types/SkillPlugin.js";

type SkillSystemRuntime = {
  rootPath: string;
  options?: SkillPluginOptions | null;
};

/**
 * 构建 skill plugin system 文本。
 *
 * 算法流程（中文）
 * 1) 扫描可用 skills
 * 2) 更新 session 的可用技能快照（仅用于观察态）
 * 3) 输出 skills overview 文本
 */
export async function buildSkillsSystemText(
  runtime: SkillSystemRuntime,
  run_context?: PluginRunContext,
): Promise<string> {
  const session_id = String(run_context?.session_id || "").trim();
  const discoveredSkills = discoverSkillsSync(
    runtime.rootPath,
    runtime.options,
  );

  if (session_id) {
    setSessionAvailableSkills(session_id, discoveredSkills);
  }

  return render_skills_prompt_section(
    runtime.rootPath,
    runtime.options,
    discoveredSkills,
  ).trim();
}
