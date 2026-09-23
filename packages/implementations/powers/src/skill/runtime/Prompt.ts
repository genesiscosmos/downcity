/**
 * Skill power prompt 渲染器。
 *
 * 关键点（中文）
 * - 只渲染「当前 Agent 可用 skill 清单」与作用域说明，不做文件 IO。
 * - 稳定规则放在 `SkillPromptAssets.ts`，避免散落在代码里维护。
 */

import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type { SkillRoot } from "@/skill/types/SkillRoot.js";

/**
 * 渲染 skills 系统提示片段。
 *
 * 约束（中文）
 * - 只展示当前 Agent 私有目录里的 skill，即模型默认可用集合。
 * - 不设展示条数上限；清单本身必须与 `list` 的默认结果一致。
 */
export function render_skills_prompt_section(input: {
  /**
   * 当前 Agent 的可用 skill。
   */
  skills: SkillDefinition[];
  /**
   * 当前 Agent 的私有扫描根；为空表示尚未创建。
   */
  agent_root: SkillRoot | null;
  /**
   * 额外可读来源的扫描根。
   */
  extra_roots: SkillRoot[];
}): string {
  const skills_section =
    input.skills.length > 0
      ? input.skills
          .map((skill) => {
            const description = skill.description ? ` - ${skill.description}` : "";
            return `- **${skill.name}**${description}`;
          })
          .join("\n")
      : "- (none)";

  const extra_roots_section =
    input.extra_roots.length > 0
      ? input.extra_roots
          .map((root) => `- [${root.source}] ${root.display}`)
          .join("\n")
      : "- (none)";

  return [
    "# Runtime Skills Inventory",
    "",
    `Discovered ${input.skills.length} skill(s) available to this agent.`,
    "All skills in `Available Skills` are already available locally.",
    "",
    "## Available Skills",
    skills_section,
    "",
    "## Agent Skill Directory",
    input.agent_root ? `- ${input.agent_root.display}` : "- (not created yet)",
    "",
    "## Extra Readable Sources",
    "These are readable on demand through `list` / `lookup` with an explicit scope.",
    extra_roots_section,
  ].join("\n");
}
