/**
 * Skill power system 文本构建器。
 *
 * 关键点（中文）
 * - 只输出「当前 Agent 可用 skill」概览，不写入任何会话级状态。
 * - `lookup` 由 action 读取 `SKILL.md` 后通过标准消息协议注入。
 */

import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type { ResolvedSkillPowerOptions } from "@/skill/types/SkillPower.js";
import { discover_skills } from "./Discovery.js";
import { resolve_skill_root, type SkillRootContext } from "./Paths.js";
import { render_skills_prompt_section } from "./Prompt.js";

/**
 * 构建 skill power system 文本。
 *
 * 算法流程（中文）
 * 1) 解析当前 Agent 的私有扫描根。
 * 2) 扫描该根下的 skill，作为默认可用集合。
 * 3) 渲染清单、Agent 目录与额外可读来源。
 */
export function build_skills_system_text(input: {
  /**
   * 当前 Agent 与 Workspace 的路径事实。
   */
  context: SkillRootContext;
  /**
   * 归一化后的 power 选项。
   */
  options: ResolvedSkillPowerOptions;
}): string {
  const agent_root = resolve_skill_root("agent", input.context);
  const skills: SkillDefinition[] = agent_root
    ? discover_skills([agent_root], input.options)
    : [];

  const extra_roots = (["project", "home"] as const)
    .map((source) => resolve_skill_root(source, input.context))
    .filter((root): root is NonNullable<typeof root> => Boolean(root));

  return render_skills_prompt_section({
    skills,
    agent_root,
    extra_roots,
  }).trim();
}
